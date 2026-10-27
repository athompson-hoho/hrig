import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
const platform = process.platform,
  arch = process.arch;
if (
  !["win32", "darwin", "linux"].includes(platform) ||
  !["x64", "arm64"].includes(arch)
)
  throw new Error("Unsupported native build host.");
const output = process.env.HRIG_PACKAGE_STAGING
  ? path.resolve(process.env.HRIG_PACKAGE_STAGING)
  : path.resolve(
      "release",
      `staging-${version}-${platform}-${arch}-${Date.now()}`,
    );
const args = [
  require.resolve("electron-builder/cli.js"),
  platform === "win32" ? "--win" : platform === "darwin" ? "--mac" : "--linux",
  `--${arch}`,
  "--publish",
  "never",
  `--config.directories.output=${output}`,
];
if (platform !== "win32") args.push("--config.npmRebuild=true");
const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    ELECTRON_BUILDER_COMPRESSION_LEVEL:
      process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL || "5",
  },
});
const code = await new Promise((resolve) => {
  child.once("error", (e) => {
    console.error(e.message);
    resolve(1);
  });
  child.once("exit", resolve);
});
if (code !== 0) process.exit(Number(code) || 1);
await fs.mkdir("release", { recursive: true });
const files = [];
for (const name of await fs.readdir(output)) {
  if (!/\.(exe|dmg|zip|AppImage|tar\.gz)$/.test(name)) continue;
  const normalized = name.replace("linux-x86_64.", "linux-x64.");
  const file = path.resolve("release", normalized);
  await fs.copyFile(path.join(output, name), file);
  const data = await fs.readFile(file);
  files.push({
    name: normalized,
    size: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
  });
}
if (!files.length) throw new Error("No distributable artifacts were produced.");
const suffix = arch === "x64" ? "" : `-${arch}`;
const executable =
  platform === "win32"
    ? path.join(output, `win${suffix}-unpacked`, "HRig.exe")
    : platform === "darwin"
      ? path.join(
          output,
          `mac${suffix}`,
          "HRig.app",
          "Contents",
          "MacOS",
          "HRig",
        )
      : path.join(output, `linux${suffix}-unpacked`, "hrig");
await fs.access(executable);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const manifest = { version, platform, arch, commit, files };
await fs.writeFile(
  `release/artifacts-${platform}-${arch}.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
await fs.writeFile(
  "release/latest.json",
  JSON.stringify(
    {
      version,
      platform,
      arch,
      portable:
        platform === "win32"
          ? path.resolve("release", `HRig ${version}.exe`)
          : path.resolve("release", files[0].name),
      executable,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Ready: ${platform}/${arch}: ${files.map((f) => f.name).join(", ")}`,
);
