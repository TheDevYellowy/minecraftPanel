'use strict';

const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const config = require('./config.json');
const Tail = require('./util/Tail');
const { join } = require('path');

const socket = new WebSocketServer({ port: 25500 });

var lastOnline = {};
var mcServer = spawn('java', [
    '--add-modules=jdk.incubator.vector',
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-jar',
    config.serverName,
    '--nogui'
], {
    stdio: 'pipe',
    cwd: process.cwd()
});

mcServer.stdout.pipe(process.stdout);
mcServer.stdin.pipe(process.stdin);

var tail = new Tail(join(process.cwd(), 'logs', 'latest.log'));

function heartbeat() {
    this.isAlive = true;
}

socket.on('connection', async (ws) => {
    ws.isAlive = true;
    ws.on('message', async (message) => {
        mcPut(message);
    });
    ws.on('pong', heartbeat);
    ws.on('command', (command, args) => {
        switch(command) {
            case 'lastOnline':
                ws.send(lastOnline[args]);
                break;
        }
    })
});

const interval = setInterval(function ping() {
    socket.clients.forEach(function each(ws) {
      if (ws.isAlive === false) return ws.terminate();
  
      ws.isAlive = false;
      ws.ping();
    });
}, 30000);

socket.on('close', () => {
    clearInterval(interval);
})

const regexpLog = /^\[(.*)]\s\[([^/]*)\/(.*)][^:]*:\s(.*)$/;
const leave = /^(.*)\sleft\sthe\sgame$/;
tail.on('line', line => {
    if(!regexpLog.test(line)) return;

    const [log, time, causedAt, level, message] = regexpLog.exec(line);
    console.log({ log, time, causedAt, level, message });

    if(causedAt !== 'Server thread' || level !== 'INFO') return;
    if(leave.test(message)) {
        let username = message.split(' ')[0];
        lastOnline[username] = Date.now();
    }
})