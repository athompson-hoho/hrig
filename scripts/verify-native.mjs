import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url),
  yaml = require("js-yaml");
const { feedName } = require("../electron/release-model.cjs");
const latest = JSON.parse(await fs.readFile("release/latest.json", "utf8"));
const manifest = JSON.parse(
  await fs.readFile(
    `release/artifacts-${latest.platform}-${latest.arch}.json`,
    "utf8",
  ),
);
const feed = yaml.load(
  await fs.readFile(
    path.join("release", feedName(latest.platform, latest.arch)),
    "utf8",
  ),
);
if (
  feed.version !== latest.version ||
  !Array.isArray(feed.files) ||
  !feed.files.length
)
  throw new Error("Invalid update feed.");
for (const f of feed.files) {
  if (typeof f.url !== "string" || path.basename(f.url) !== f.url)
    throw new Error("Update feed must reference local release assets.");
  const data = await fs.readFile(path.join("release", f.url));
  if (crypto.createHash("sha512").update(data).digest("base64") !== f.sha512)
    throw new Error("Update feed hash mismatch.");
}
let signatureVerified = false;
if (manifest.policy.signed) {
  if (latest.platform === "win32") {
    for (const file of [
      latest.executable,
      ...manifest.files
        .filter((f) => f.name.endsWith("-setup.exe"))
        .map((f) => path.resolve("release", f.name)),
    ])
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          "scripts/verify-signature.ps1",
          file,
          manifest.policy.publisherName,
        ],
        { stdio: "inherit", windowsHide: true },
      );
  } else if (latest.platform === "darwin") {
    const bundle = path.resolve(latest.executable, "../../..");
    execFileSync(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", bundle],
      { stdio: "inherit" },
    );
    execFileSync("xcrun", ["stapler", "validate", bundle], {
      stdio: "inherit",
    });
  } else throw new Error("Unexpected signing policy.");
  signatureVerified = true;
}
if (latest.platform === "linux")
  for (const f of manifest.files) {
    if (f.name.endsWith(".deb"))
      execFileSync("dpkg-deb", ["--info", path.join("release", f.name)], {
        stdio: "pipe",
      });
    if (f.name.endsWith(".rpm"))
      execFileSync("rpm", ["-qip", path.join("release", f.name)], {
        stdio: "pipe",
      });
  }
await fs.writeFile(
  `release/distribution-qa-${latest.platform}-${latest.arch}.json`,
  JSON.stringify(
    {
      version: latest.version,
      platform: latest.platform,
      arch: latest.arch,
      feedVerified: true,
      signingConfigured: manifest.policy.signed,
      signatureVerified,
      packagesVerified: true,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified package metadata and SHA-512 update feed; signing ${signatureVerified ? "verified" : "not configured (in-app installation disabled)"}.`,
);
