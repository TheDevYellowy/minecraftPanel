"use strict";

console.clear();
const { app, BrowserWindow, ipcMain } = require("electron");
const { WebSocket } = require("ws");

if (require("electron-squirrel-startup")) app.quit();

/** @type {BrowserWindow} */
var main;
/** @type {WebSocket | null} */
var socket = null;
/** @type {string} */
var version;

const loaderType = {
  Forge: 1,
  Cauldron: 2,
  LiteLoader: 3,
  Fabric: 4,
  Quilt: 5,
  NeoForge: 6,
};

function createWindow() {
  main = new BrowserWindow({
    width: 935,
    height: 595,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  main.loadFile("views/login.html");
}

async function connect(ip, password) {
  if (socket !== null) return socket.send(JSON.stringify({ command: "getData" }));
  socket = new WebSocket(`ws://${ip}:25500`);

  socket.on("open", () => {
    socket.send(JSON.stringify({ command: "auth", pswd: password }));
  });

  socket.on("message", (data) => {
    const url = getURL();
    try {
      const json = JSON.parse(data.toString());
      const event = json.event;
      delete json.event;

      switch (event) {
        case "auth":
          console.log(json);
          if (json.success) {
            main.loadFile("views/index.html");
          } else {
            main.webContents.send("wrong");
          }
          break;
        case "data":
          if (json.version) version = json.version;
          main.webContents.send(event, json);
          break;

        case "log":
          if (url !== "logs") return;
          main.webContents.send(event, json.message);
          break;

        case "logs":
          if (url !== "logs") return;
          main.webContents.send("logs", json.messages);
          break;

        case "settings":
          if (url !== "settings") return;
          main.webContents.send("settings", json.properties);
          break;
      }
    } catch (error) {
      console.error(`Error in message event: ${error}`);
    }
  });
}

ipcMain
  .on("login", (ev, { ip, password }) => connect(ip, password))
  .on("changeTab", (_ev, file) => main.loadFile(`views/${file}.html`))
  .on("getData", () => socket.send(JSON.stringify({ command: "getData" })))
  .on("getLogs", () => socket.send(JSON.stringify({ command: "getLogs" })))
  .on("getSettings", () => socket.send(JSON.stringify({ command: "getSettings" })))
  .on("setSettings", (_, data) => socket.send(JSON.stringify({ command: "setSettings", data })))
  .on("command", (_, cmd) => socket.send(JSON.stringify({ command: "command", message: cmd })))
  .on("downloadPack", (_, pack) =>
    socket.send(JSON.stringify({ command: "downloadModpack", modpackId: pack.id }))
  )
  .on("downloadMod", (_, mod) =>
    socket.send(JSON.stringify({ command: "downloadMod", modId: mod.id, fileId: mod.fileId }))
  );

ipcMain.on("request", async (requester, data) => {
  const classId = data.class;
  const param = new URLSearchParams();
  param.set("gameId", "432");
  param.set("classId", classId);
  param.set("searchFilter", data.name);
  param.set("sortField", "2");
  param.set("sortOrder", "desc");
  if (data.class == "6" && version) {
    param.set("gameVersion", version.split(" ")[1]);
    param.set("modLoaderType", loaderType[version.split(" ")[0]]);
  }

  const req = await fetch(`https://api.curseforge.com/v1/mods/search?${param.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": "$2a$10$I86S6MDkrvOjKvBafbwsOuJYVbBXR92vk6X/7DurN.PEaWMt01gDe",
    },
  });

  if (req.ok) {
    const data = (await req.json()).data;

    requester.reply("response", { class: classId, version: version.split(" ")[0], ...data });
  }
});

function getURL() {
  return main.webContents.getURL().split("/").slice(-1)[0].split(".")[0];
}

app.whenReady().then(() => {
  createWindow();
});
