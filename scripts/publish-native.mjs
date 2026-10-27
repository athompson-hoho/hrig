import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const repo = "athompson-hoho/hrig";
const run = (file, args) =>
  execFileSync(file, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 900000,
  }).trim();
const git = (...args) => run("git", args),
  gh = (...args) => run("gh", args),
  api = (endpoint) => JSON.parse(gh("api", endpoint));
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid version.");
const commit = git("rev-parse", "HEAD"),
  tag = "v" + version;
if (git("status", "--porcelain"))
  throw new Error("Release source must be committed.");
if (
  JSON.parse(gh("repo", "view", repo, "--json", "visibility")).visibility !==
  "PUBLIC"
)
  throw new Error("Release repository visibility changed.");
const notesFile = `releases/${tag}.md`,
  notes = await fs.readFile(notesFile, "utf8");
for (const heading of [
  "## Validation",
  "## Known limitations",
  "## Install or upgrade",
  "## Integrity and source",
])
  if (!notes.includes(heading))
    throw new Error("Missing release notes: " + heading);
const targets = [
  ["win32", "x64"],
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["linux", "x64"],
  ["linux", "arm64"],
];
const assets = [];
for (const [platform, arch] of targets) {
  const manifest = JSON.parse(
    await fs.readFile(`release/artifacts-${platform}-${arch}.json`, "utf8"),
  );
  const evidence = JSON.parse(
    await fs.readFile(`release/native-smoke-${platform}-${arch}.json`, "utf8"),
  );
  if (
    manifest.version !== version ||
    manifest.commit !== commit ||
    manifest.platform !== platform ||
    manifest.arch !== arch ||
    evidence.version !== version ||
    evidence.platform !== platform ||
    evidence.arch !== arch ||
    !evidence.passed
  )
    throw new Error("Artifact or native QA source mismatch.");
  const expected =
    platform === "win32"
      ? [`HRig ${version}.exe`]
      : platform === "darwin"
        ? [
            `HRig-${version}-macos-${arch}.dmg`,
            `HRig-${version}-macos-${arch}.zip`,
          ]
        : [
            `HRig-${version}-linux-${arch}.AppImage`,
            `HRig-${version}-linux-${arch}.tar.gz`,
          ];
  if (
    manifest.files.length !== expected.length ||
    expected.some((name) => !manifest.files.some((f) => f.name === name))
  )
    throw new Error("Missing distribution for " + platform + "/" + arch);
  for (const f of manifest.files) {
    if (path.basename(f.name) !== f.name)
      throw new Error("Invalid artifact filename.");
    const file = path.join("release", f.name),
      data = await fs.readFile(file),
      hash = crypto.createHash("sha256").update(data).digest("hex");
    if (hash !== f.sha256 || data.length !== f.size)
      throw new Error("Artifact integrity check failed: " + f.name);
    assets.push({
      file,
      name: f.name.replaceAll(" ", "."),
      hash,
      size: data.length,
    });
  }
}
const checksum = path.join("release", `HRig-${version}-SHA256SUMS.txt`);
await fs.writeFile(
  checksum,
  assets.map((a) => `${a.hash}  ${a.name}\n`).join(""),
);
const checksumData = await fs.readFile(checksum);
assets.push({
  file: checksum,
  name: path.basename(checksum),
  hash: crypto.createHash("sha256").update(checksumData).digest("hex"),
  size: checksumData.length,
});
const validation = path.join("release", `HRig-${version}-NATIVE-QA.json`);
await fs.writeFile(
  validation,
  JSON.stringify(
    {
      version,
      commit,
      targets: await Promise.all(
        targets.map(async ([p, a]) =>
          JSON.parse(
            await fs.readFile(`release/native-smoke-${p}-${a}.json`, "utf8"),
          ),
        ),
      ),
    },
    null,
    2,
  ) + "\n",
);
const qaData = await fs.readFile(validation);
assets.push({
  file: validation,
  name: path.basename(validation),
  hash: crypto.createHash("sha256").update(qaData).digest("hex"),
  size: qaData.length,
});
if (git("tag", "--list", tag)) {
  if (git("rev-parse", tag + "^{commit}") !== commit)
    throw new Error("Existing tag identifies a different source.");
} else {
  git(
    "-c",
    "user.name=HRig Release",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "tag",
    "-a",
    tag,
    commit,
    "-m",
    `HRig ${version}: native macOS, Linux and Windows release`,
  );
  git("push", "origin", `refs/tags/${tag}`);
}
let remote = api(`repos/${repo}/releases?per_page=100`).find(
  (r) => r.tag_name === tag,
);
if (!remote) {
  gh(
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--verify-tag",
    "--draft",
    "--title",
    `HRig ${version} - macOS, Linux and Windows`,
    "--notes-file",
    notesFile,
  );
  remote = api(`repos/${repo}/releases?per_page=100`).find(
    (r) => r.tag_name === tag,
  );
}
if (!remote) throw new Error("Release draft not found.");
for (const a of assets) {
  const prior = remote.assets.find((r) => r.name === a.name);
  if (prior && (prior.size !== a.size || prior.digest !== `sha256:${a.hash}`))
    throw new Error(
      "Refusing to overwrite a different published asset: " + a.name,
    );
  if (!prior) gh("release", "upload", tag, a.file, "--repo", repo);
}
remote = api(`repos/${repo}/releases/${remote.id}`);
for (const a of assets) {
  const uploaded = remote.assets.find((r) => r.name === a.name);
  if (
    !uploaded ||
    uploaded.state !== "uploaded" ||
    uploaded.size !== a.size ||
    uploaded.digest !== `sha256:${a.hash}`
  )
    throw new Error("Remote hash verification failed: " + a.name);
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
  "--latest=true",
);
remote = api(`repos/${repo}/releases/${remote.id}`);
if (remote.draft || remote.body.trim() !== notes.trim())
  throw new Error("Release publication did not match its notes.");
console.log(
  "Published all five native targets with verified hashes: " + remote.html_url,
);
