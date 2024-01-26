"use strict";

const { WebSocketServer } = require("ws");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");

const wss = new WebSocketServer({ port: 25500 });

const hardcoded = {
  curseforgeKey: "$2a$10$I86S6MDkrvOjKvBafbwsOuJYVbBXR92vk6X/7DurN.PEaWMt01gDe",
  curseforgeBase: "https://api.curseforge.com",
};

const exists = fs.existsSync("./server");

/** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
var mc;

const lastOnline = {};
const online = [];
if (exists) {
  let script = fs.readdirSync("./server").filter((file) => file == "run.sh")[0];
  if (script == undefined) {
  }

  mc = spawn(script, {
    stdio: "pipe",
    cwd: path.join(process.cwd(), "server"),
  });

  const regexpLog = /^\[(.*)]\s\[([^/]*)\/(.*)][^:]*:\s(.*)$/;
  const leave = /^(.*)\sleft\sthe\sgame$/;

  mc.stdout.on("data", (line) => {
    line = line.toString();
    if (!regexpLog.test(line)) return;

    const [log, time, causedAt, level, message] = regexpLog.exec(line);
    if (causedAt !== "Server thread" || level !== "INFO") return;
  });
}

console.log(fs.readdirSync("./server").filter((file) => file == "run.sh")[0]);
