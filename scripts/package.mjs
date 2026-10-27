import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
// Fresh output avoids Windows archive handles held by an open app or IDE.
const output = path.resolve("release", `staging-${version}-${Date.now()}`);
const child = spawn(
  process.execPath,
  [
    require.resolve("electron-builder/cli.js"),
    "--win",
    "portable",
    `--config.directories.output=${output}`,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_BUILDER_COMPRESSION_LEVEL:
        process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL || "5",
    },
  },
);
const code = await new Promise((resolve) => {
  child.once("error", (error) => {
    console.error(error.message);
    resolve(1);
  });
  child.once("exit", resolve);
});
if (code !== 0) process.exit(Number(code) || 1);
const portable = path.resolve("release", `HRig ${version}.exe`);
await fs.copyFile(path.join(output, `HRig ${version}.exe`), portable);
await fs.writeFile(
  "release/latest.json",
  JSON.stringify(
    {
      version,
      portable,
      executable: path.join(output, "win-unpacked", "HRig.exe"),
    },
    null,
    2,
  ),
);
console.log(`Ready: ${portable}`);
