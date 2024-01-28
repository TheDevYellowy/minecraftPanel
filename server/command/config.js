"use strict";

const fs = require("node:fs");
const path = require("node:path");
module.exports = (cmd, key, value) => {
  const text = fs.readFileSync(path.join(process.cwd(), "config.json")).toString();
  const json = JSON.parse(text);
  if (cmd == "list") {
    Object.keys(json).forEach((k) => {
      console.log(`${k}=${json[k]}`);
    });
  } else {
    json[key] = value;
    fs.writeFileSync(path.join(process.cwd(), "config.json"), JSON.stringify(json, null, 2));
  }
};
