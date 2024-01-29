"use strict";

console.clear();
const { program } = require("commander");

program.version("0.0.1");
const pkg = require("./package.json");

(async () => {
  const test = await fetch(
    "https://raw.githubusercontent.com/TheDevYellowy/mincraftPanel/main/server/package.json"
  );

  if (test.ok) {
    const rawPackage = await test.json();
    if (pkg.version !== rawPackage.version)
      console.log(`There is a new update available you can get it by running "${pkg.name} update"`);
  }

  program
    .command("pswd")
    .description("sets the password that clients have to enter")
    .argument("<password>")
    .action((password) => {
      require("./command/pswd")(password);
    });

  program
    .command("config")
    .description("edit or list the config")
    .argument("<cmd>", "either edit or list")
    .argument("[key]")
    .argument("[value]")
    .action((cmd, key, value) => {
      if (!["edit", "list"].includes(cmd))
        return console.log(`error: argument "${cmd}" is invalid. Choices are edit or list`);
      require("./command/config")(cmd, key, value);
    });

  program
    .command("update")
    .description("updates the script")
    .action(() => require("./command/update"));

  program.command("run", "run the server", { isDefault: true, executableFile: "command/run.js" });

  program.parse();
})();
