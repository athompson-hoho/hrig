import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

// Explicit publishing only: npm run release:publish -- [version ...]
const repo = "athompson-hoho/hrig";
const manifest = JSON.parse(
  await fs.readFile("releases/manifest.json", "utf8"),
);
const requested = process.argv.slice(2).filter((a) => a !== "--check");
const checkOnly = process.argv.includes("--check");
const releases = requested.length
  ? manifest.filter((r) => requested.includes(r.version))
  : manifest;
if (
  !releases.length ||
  requested.some((v) => !manifest.some((r) => r.version === v))
)
  throw new Error("Choose versions listed in releases/manifest.json.");
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 900000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
const api = (endpoint) => JSON.parse(gh("api", endpoint));
async function hash(file) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
if (!checkOnly && git("status", "--porcelain"))
  throw new Error("Commit changes before publishing.");
const metadata = JSON.parse(
  gh("repo", "view", repo, "--json", "visibility,url"),
);
if (metadata.visibility !== "PRIVATE")
  throw new Error("Refusing to publish: this repository must be private.");
const prepared = [];
for (const release of releases) {
  const { version, sourceRef } = release;
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid version in manifest.");
  const tag = "v" + version;
  const notesFile = path.resolve("releases", tag + ".md");
  const notes = await fs.readFile(notesFile, "utf8");
  if (
    notes.length < 800 ||
    !notes.includes("## Known limitations") ||
    !notes.includes("## Install or upgrade") ||
    !notes.includes("## Integrity and source")
  )
    throw new Error("Write complete release notes for " + tag);
  const exe = path.resolve("release", `HRig ${version}.exe`);
  const digest = await hash(exe);
  const checksum = path.resolve("release", `HRig-${version}-SHA256SUMS.txt`);
  await fs.writeFile(checksum, `${digest}  ${path.basename(exe)}\n`);
  let ref = git("tag", "--list", tag) ? tag : sourceRef;
  const commit = git("rev-parse", ref + "^{commit}");
  const pkg = JSON.parse(git("show", commit + ":package.json"));
  if (pkg.version !== version)
    throw new Error(`Source version ${pkg.version} does not match ${tag}.`);
  prepared.push({
    ...release,
    tag,
    commit,
    notesFile,
    notes,
    assets: [
      { file: exe, hash: digest },
      { file: checksum, hash: await hash(checksum) },
    ],
  });
  console.log(
    `${tag}: source ${commit.slice(0, 12)}, notes and executable checked`,
  );
}
if (checkOnly) process.exit(0);
git("push", "origin", "HEAD:refs/heads/master");
for (const release of prepared) {
  const { version, tag, title, commit, notesFile, notes, assets } = release;
  if (!git("tag", "--list", tag))
    git("tag", "-a", tag, commit, "-m", `HRig ${version}: ${title}`);
  git("push", "origin", `refs/tags/${tag}`);
  const existing = api(`repos/${repo}/releases?per_page=100`).find(
    (r) => r.tag_name === tag,
  );
  if (!existing)
    gh(
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--verify-tag",
      "--draft",
      "--title",
      `HRig ${version} - ${title}`,
      "--notes-file",
      notesFile,
    );
  let remote = api(`repos/${repo}/releases?per_page=100`).find(
    (r) => r.tag_name === tag,
  );
  if (!remote) throw new Error("Release creation was not confirmed: " + tag);
  for (const asset of assets) {
    if (!remote.assets.some((a) => a.name === path.basename(asset.file))) {
      console.log(`Uploading ${tag}: ${path.basename(asset.file)}`);
      gh("release", "upload", tag, asset.file, "--repo", repo);
    }
  }
  remote = api(`repos/${repo}/releases/${remote.id}`);
  for (const asset of assets) {
    const uploaded = remote.assets.find(
      (a) => a.name === path.basename(asset.file),
    );
    if (
      !uploaded ||
      uploaded.state !== "uploaded" ||
      uploaded.size !== (await fs.stat(asset.file)).size
    )
      throw new Error("Incomplete upload: " + asset.file);
    if (uploaded.digest) {
      if (uploaded.digest !== "sha256:" + asset.hash)
        throw new Error("Remote checksum mismatch: " + asset.file);
    } else {
      const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), "hrig-release-verify-"),
      );
      try {
        gh(
          "release",
          "download",
          tag,
          "--repo",
          repo,
          "--pattern",
          uploaded.name,
          "--dir",
          dir,
        );
        if ((await hash(path.join(dir, uploaded.name))) !== asset.hash)
          throw new Error("Downloaded checksum mismatch.");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  }
  gh(
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--notes-file",
    notesFile,
    "--draft=false",
    `--latest=${version === manifest.at(-1).version}`,
  );
  remote = api(`repos/${repo}/releases/${remote.id}`);
  if (remote.draft || remote.body.trim() !== notes.trim())
    throw new Error("Release publication verification failed: " + tag);
  console.log(`Published and verified: ${remote.html_url}`);
}
