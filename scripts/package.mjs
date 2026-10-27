import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
const {
  makePolicy,
  feedName,
  downloads,
} = require("../electron/release-model.cjs");
const platform = process.platform,
  arch = process.arch;
const policy = makePolicy(platform, arch);
await fs.mkdir("release", { recursive: true });
await fs.writeFile(
  "release/policy.json",
  JSON.stringify(policy, null, 2) + "\n",
);
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
  `--config.publish.channel=${policy.channel}`,
];
if (platform !== "win32") args.push("--config.npmRebuild=true");
if (platform === "linux")
  args.push(
    `--config.linux.artifactName=HRig-${version}-linux-${arch}.\${ext}`,
  );
if (platform === "darwin" && policy.signed)
  args.push("--config.mac.notarize=true");
if (platform === "win32" && policy.signed)
  args.push(
    "--config.win.signExecutable=true",
    `--config.win.publisherName=${policy.publisherName}`,
    "--config.win.verifyUpdateCodeSignature=true",
  );
const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: policy.signed ? "true" : "false",
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
  if (
    !/\.(exe|dmg|zip|AppImage|tar\.gz|deb|rpm|blockmap)$/.test(name) &&
    name !== feedName(platform, arch)
  )
    continue;
  const normalized = name;
  const file = path.resolve("release", normalized);
  await fs.copyFile(path.join(output, name), file);
  const data = await fs.readFile(file);
  files.push({
    name: normalized,
    size: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    role: name.endsWith(".blockmap")
      ? "blockmap"
      : name.endsWith(".yml")
        ? "feed"
        : "distribution",
  });
}
if (!files.length) throw new Error("No distributable artifacts were produced.");
for (const name of [
  ...downloads(version, platform, arch),
  feedName(platform, arch),
])
  if (!files.some((f) => f.name === name))
    throw new Error("Missing release artifact: " + name);
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
const manifest = { version, platform, arch, commit, files, policy };
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
          ? path.resolve(
              "release",
              `HRig-${version}-windows-${arch}-portable.exe`,
            )
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
