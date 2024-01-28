"use strict";

const fs = require("node:fs");
const path = require("node:path");
module.exports = (pswd) => {
  const text = fs.readFileSync(path.join(process.cwd(), "config.json")).toString();
  const json = JSON.parse(text);

  json.pswd = pswd;
  fs.writeFileSync(path.join(process.cwd(), "config.json"), JSON.stringify(json, null, 2));
};
