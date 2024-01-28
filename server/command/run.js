const { WebSocketServer } = require("ws");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");

const decompress = require("decompress");
const cliProgress = require("cli-progress");
const request = require("request");
const requestProgress = require("request-progress");

try {
  var config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config.json")));
} catch (error) {
  console.log(`Detected incorrect json in config.json, resetting it`);
  fs.writeFileSync(
    path.join(process.cwd(), "config.json"),
    JSON.stringify(
      {
        restart: false,
      },
      null,
      2
    )
  );
  process.exit();
}

const wss = new WebSocketServer({ port: 25500 });

const hardcoded = {
  curseforgeKey: "$2a$10$I86S6MDkrvOjKvBafbwsOuJYVbBXR92vk6X/7DurN.PEaWMt01gDe",
  curseforgeBase: "https://api.curseforge.com",
};

const exists = fs.existsSync(path.join(process.cwd(), "server"));

/** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
var mc;

const lastOnline = new Map();
const properties = new Map();
const online = [];
var serverOnline = false;
var needEula;

function startServer() {
  let script = fs
    .readdirSync(path.join(process.cwd(), "server"))
    .filter((file) => file.includes("run") || file.includes("start"))
    .filter((file) => file.endsWith(".sh"))[0];
  if (script == undefined) return;

  console.log(script);

  mc = spawn(`./${script}`, {
    cwd: path.join(process.cwd(), "server"),
  });
  mc.stdout.setEncoding("utf8");

  const regexpLog = /^\[(.*)]\s\[([^/]*)\/(.*)][^:]*:\s(.*)$/;
  const leave = /^(.*)\sleft\sthe\sgame$/;
  const join = /^(.*)\sjoined\sthe\sgame$/;

  mc.on("error", (err) => {
    console.error(`Error spawning mc server: ${err}`);
  });

  mc.stdout.on("data", (line) => {
    line = line.toString();

    broadcast({ event: "log", message: line });
    if (!regexpLog.test(line)) return;

    const [log, time, causedAt, level, message] = regexpLog.exec(line);
    if (causedAt !== "Server thread" || level !== "INFO") return;

    if (leave.test(message)) {
      const username = message.split(" ")[0];
      lastOnline.set(username, Date.now());
      if (online.indexOf(username) !== 0) online.splice(online.indexOf(username));

      const lo = toObject(lastOnline);
      broadcast({ event: "leave", lastOnline: lo, online });
    }

    if (join.test(message)) {
      const username = message.split(" ")[0];
      lastOnline.delete(username);
      online.push(username);

      const lo = toObject(lastOnline);
      broadcast({ event: "join", lastOnline: lo, online });
    }

    if (message.trim().endsWith("seconds to load")) serverOnline = true;
    if (message.trim().includes("You need to agree to the EULA")) needEula = true;
  });

  mc.once("close", () => {
    mc.removeAllListeners();
    mc.stdout.removeAllListeners();
    mc.stdin.removeAllListeners();

    const temp = {};
    lastOnline.forEach((v, k) => {
      temp[k] = v;
    });
    fs.writeFileSync(path.join(process.cwd(), "lastOnline.json"), JSON.stringify(temp, null, 2));

    serverOnline = false;

    if (!needEula && config.restart) {
      return startServer();
    }
  });
}

if (exists) {
  startServer();
}

wss.on("connection", (socket) => {
  const sock = {};
  sock.authed = false;
  sock.zombie = false;

  sock.interval = setInterval(() => {
    if (sock.zombie == true) {
      delete sock;
      return socket.removeAllListeners().terminate();
    }

    sock.zombie = true;
    socket.ping();
  }, 20000);

  socket.once("close", () => {
    clearInterval(sock.interval);
    socket.removeAllListeners();
  });

  socket.on("pong", () => {
    sock.zombie = false;
  });

  socket.on("message", async (data) => {
    try {
      const json = JSON.parse(data.toString());

      if (json.command !== "auth" && !sock.authed) return;

      switch (json.command) {
        case "auth": {
          try {
            if (json.pswd !== config.pswd) {
              return socket.send(JSON.stringify({ event: "auth", success: false }));
            } else socket.send(JSON.stringify({ event: "auth", success: true }));

            sock.authed = true;
            break;
          } catch (error) {
            console.log(`Error in auth catch: ${error}`);
            break;
          }
        }

        case "eula":
          if (!exists) fs.mkdirSync("server");
          const date = new Date();
          const dArr = date.toDateString().split(" ");
          const tArr = date.toTimeString().split(" ");
          const tz = tArr
            .slice(2, 5)
            .join("")
            .split("")
            .filter((c) => {
              if (/[A-Z]/.test(c)) return /[A-Z]/.exec(c)[0];
            })
            .join("");
          const text = `#${dArr[0]} ${dArr[1]} ${dArr[2]} ${tArr[0]} ${tz} ${dArr[3]}\neula=true`;
          fs.writeFileSync(path.join(process.cwd(), "server", "eula.txt"), text);
          break;

        case "command":
          if (serverOnline) mc.stdin.write(`${json.message}\n`);
          break;

        case "downloadModpack":
          await download(json.modpackId);
          break;

        case "downloadMod":
          await downloadMod(json.modId, json.fileId);

        case "getData":
          let prop = toObject(properties);
          let lo = toObject(lastOnline);

          if (fs.existsSync(path.join(process.cwd(), "version.txt"))) {
            const version = fs.readFileSync(path.join(process.cwd(), "version.txt")).toString();
            return socket.send(
              JSON.stringify({
                event: "data",
                online,
                lastOnline: lo,
                properties: prop,
                serverOnline,
                version,
              }),
              (err) => {
                if (err != null) console.log(`Error in auth socket.send: ${err}`);
              }
            );
          }

          socket.send(
            JSON.stringify({
              event: "data",
              online,
              lastOnline: lo,
              properties: prop,
              serverOnline,
            }),
            (err) => {
              if (err != null) console.log(`Error in getData socket.send: ${err}`);
            }
          );
          break;

        case "getLogs":
          const logFile = fs
            .readFileSync(path.join(process.cwd(), "server", "logs", "latest.log"))
            .toString();
          socket.send(JSON.stringify({ event: "logs", messages: logFile.split("\n") }));
          break;

        case "getSettings": {
          let prop = toObject(properties);
          socket.send(JSON.stringify({ event: "settings", properties: prop }));
          break;
        }

        case "setSettings": {
          let prop = "";
          Object.keys(json.data).forEach((key) => {
            prop += `${key}=${json.data[key]}\n`;
            properties.set(key, json.data[key]);
          });

          fs.writeFileSync(path.join(process.cwd(), "server", "server.properties"), prop);
          break;
        }

        case "getUserData":
          break;

        case "setUserData":
          break;
      }
    } catch (error) {}
  });
});

wss.on("listening", () => {
  console.log(`Websocket Server is listening`);
  if (fs.existsSync(path.join(process.cwd(), "server", "server.properties"))) {
    const propString = fs
      .readFileSync(path.join(process.cwd(), "server", "server.properties"))
      .toString();

    propString.split("\n").forEach((line) => {
      if (line.startsWith("#")) return;

      const [key, value] = line.split("=");
      properties.set(key, value);
    });
  }
});

function broadcast(data) {
  wss.clients.forEach((socket) => {
    socket.send(JSON.stringify(data));
  });
}

/** @param {Map<any, any>} map */
function toObject(map) {
  const temp = {};
  map.forEach((v, k) => {
    temp[k] = v;
  });

  return temp;
}

async function download(id) {
  const base = hardcoded.curseforgeBase;
  const key = hardcoded.curseforgeKey;

  const modpack = await fetch(`${base}/v1/mods/${id}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": key,
    },
  });

  if (modpack.ok) {
    try {
      const json = (await modpack.json()).data;
      const latest = json.latestFiles.filter((file) => file.id == json.mainFileId)[0];
      const versions = latest.gameVersions;

      const name = versions.filter((v) => !v.includes("."))[0];
      const version = versions.filter((v) => v.includes("."))[0];

      await downloadModpack(json.id, latest.serverPackFileId);
      installLoader();

      if (name == undefined && version == "1.12.2") name = "Forge";

      fs.writeFileSync(`${path.join(process.cwd(), "version.txt")}`, `${name} ${version}`);
      if (fs.existsSync(path.join(process.cwd(), "server", "server.properties"))) {
        const propString = fs
          .readFileSync(path.join(process.cwd(), "server", "server.properties"))
          .toString();

        propString.split("\n").forEach((line) => {
          if (line.startsWith("#")) return;

          const [key, value] = line.split("=");
          properties.set(key, value);
        });
      }
    } catch (error) {}
  } else {
    console.error(`curseforge request not ok: ${modpack.status}`);
  }
}

async function downloadModpack(packId, fileId) {
  const base = hardcoded.curseforgeBase;
  const key = hardcoded.curseforgeKey;

  const serverFolder = path.join(process.cwd(), "server");

  if (fs.existsSync(serverFolder)) {
    if (fs.existsSync(path.join(process.cwd(), "server_backup"))) {
      fs.rmSync(path.join(process.cwd(), "server_backup"), { recursive: true });
    }
    console.log(`Already found a server installed, moving it to server_backup folder`);
    fs.renameSync(serverFolder, path.join(process.cwd(), "server_backup"));
  }

  const fileData = await fetch(`${base}/v1/mods/${packId}/files/${fileId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": key,
    },
  });

  const data = (await fileData.json()).data;
  const bar = new cliProgress.Bar({
    format: `${data.fileName} [{bar}] {percentage}%`,
    barCompleteChar: "▇",
  });
  let started = false;

  const pipe = fs.createWriteStream(`./${data.fileName}`);
  console.log(`Downloading ${data.fileName}`);
  return new Promise(async (resolve) => {
    await requestProgress(request(data.downloadUrl), { throttle: 100 })
      .on("progress", (state) => {
        if (!started) {
          console.clear();
          started = true;
          bar.start(Math.floor(state.size.total / 1024), 0);
        }

        bar.update(Math.floor(state.size.transferred / 1024));
      })
      .on("end", async () => {
        bar.update(bar.getTotal());
        bar.stop();

        console.clear();
        console.log(`Finished downloading ${data.fileName}`);

        console.log("Extracting...");
        await decompress(data.fileName, serverFolder);
        const folders = fs.readdirSync(serverFolder);
        if (folders.length < 5) {
          fs.readdirSync(path.join(serverFolder, folders[0])).forEach((file) => {
            fs.renameSync(path.join(serverFolder, folders[0], file), path.join(serverFolder, file));
          });

          fs.rmSync(path.join(serverFolder, folders[0]), { recursive: true });
        }

        console.clear();
        console.log("Extracted");
        fs.rmSync(`./${data.fileName}`);

        resolve();
      })
      .pipe(pipe);
  });
}

async function downloadMod(modId, fileId) {
  const base = hardcoded.curseforgeBase;
  const modFolder = path.join(process.cwd(), "server", "mods");

  if (!fs.existsSync(modFolder)) return;

  const req = fetch(`${base}/v1/mods/${modId}/files/${fileId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": hardcoded.curseforgeKey,
    },
  });

  if (req.ok) {
    const data = (await req.json()).data;

    const bar = new cliProgress.Bar({
      format: `${data.fileName} [{bar}] {percentage}%`,
      barCompleteChar: "▇",
    });
    let started = false;
    const pipe = fs.createWriteStream(path.join(modFolder, data.fileName));
    console.log(`Downloading ${data.fileName}`);
    await new Promise(async (resolve) => {
      requestProgress(request(data.downloadUrl), { throttle: 100 })
        .on("progress", (state) => {
          if (!started) {
            console.clear();
            started = true;
            bar.start(Math.floor(state.size.total / 1024), 0);
          }

          bar.update(Math.floor(state.size.transferred / 1024));
        })
        .on("end", () => {
          bar.update(bar.getTotal());
          bar.stop();

          console.clear();
          console.log(`Finished downloading ${data.fileName}`);

          resolve();
        })
        .pipe(pipe);
    });
  }
}

async function installLoader() {
  const serverFolder = path.join(process.cwd(), "server");
  if (!fs.existsSync(serverFolder)) return;

  let installer = fs.readdirSync(serverFolder).filter((file) => file.includes("installer.jar"));

  if (installer.length > 0) {
    installer = installer[0];

    const logs = fs.createWriteStream("./installer.txt");

    console.clear();
    console.log("starting installer, you can find the logs at installer.txt");

    const install = spawn("java", ["-jar", installer, "--installServer"], {
      stdio: "pipe",
      cwd: path.join(process.cwd(), "server"),
    });

    install.stdout.on("data", (line) => {
      logs.write(line);
    });

    install.once("close", () => {
      console.log(`Installed server jar, removing installer from server files`);
      fs.rmSync(`${serverFolder}/${installer}`);
      fs.rmSync(`${serverFolder}/${installer}.log`);
    });
  }
}
