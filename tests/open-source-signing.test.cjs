const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { checkOpenSource } = require("../scripts/check-open-source.cjs");

test("open-source release gate rejects missing legal metadata without treating metadata as signing approval", async () => {
  const license = await fs.readFile(path.join(__dirname, "../LICENSE"), "utf8");
  const pkg = {
    version: "1.0.0",
    license: "MIT",
    build: {
      files: ["LICENSE", "PRIVACY.md", "SIGNING.md", "THEME_CREDITS.md"],
    },
  };
  const lock = { packages: { "": { version: "1.0.0", license: "MIT" } } };
  assert.equal(
    checkOpenSource(pkg, lock, license).signPathApproval,
    "not-verified-by-this-check",
  );
  assert.throws(
    () => checkOpenSource({ ...pkg, license: "UNLICENSED" }, lock, license),
    /approved MIT/,
  );
  assert.throws(
    () =>
      checkOpenSource(
        pkg,
        { packages: { "": { license: "UNLICENSED" } } },
        license,
      ),
    /approved MIT/,
  );
  assert.throws(
    () => checkOpenSource({ ...pkg, version: "2.0.0" }, lock, license),
    /versions differ/,
  );
  assert.throws(
    () =>
      checkOpenSource({ ...pkg, build: { files: ["LICENSE"] } }, lock, license),
    /PRIVACY/,
  );
  assert.throws(
    () => checkOpenSource(pkg, lock, "MIT License without the actual grant"),
    /grant/,
  );
});

test("native signature verification covers the app, installer and portable wrapper and fails if portable verification fails", async () => {
  // This verifies orchestration with a fake verifier, not certificate trust.
  // Real Authenticode and SignPath acceptance still need provider onboarding.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-signature-test-"));
  try {
    const release = path.join(dir, "release");
    await fs.mkdir(release);
    const setup = "HRig-1.0.0-windows-x64-setup.exe";
    const portable = "HRig-1.0.0-windows-x64-portable.exe";
    const executable = path.join(dir, "HRig.exe");
    for (const file of [
      executable,
      path.join(release, setup),
      path.join(release, portable),
    ])
      await fs.writeFile(file, "fixture only; not a real executable");
    const data = await fs.readFile(path.join(release, setup));
    await fs.writeFile(
      path.join(release, "stable-win32-x64.yml"),
      `version: 1.0.0\nfiles:\n  - url: ${setup}\n    sha512: ${crypto.createHash("sha512").update(data).digest("base64")}\n`,
    );
    await fs.writeFile(
      path.join(release, "latest.json"),
      JSON.stringify({
        version: "1.0.0",
        platform: "win32",
        arch: "x64",
        executable,
      }),
    );
    await fs.writeFile(
      path.join(release, "artifacts-win32-x64.json"),
      JSON.stringify({
        policy: { signed: true, publisherName: "Fixture publisher" },
        files: [{ name: setup }, { name: portable }],
      }),
    );
    const moduleUrl = pathToFileURL(
      path.resolve(__dirname, "../scripts/verify-native.mjs"),
    ).href;
    const bootstrap = `const fs=require('node:fs'),cp=require('node:child_process');
cp.execFileSync=(file,args)=>{fs.appendFileSync('calls.jsonl',JSON.stringify({file,args})+'\\n');if(process.env.HRIG_TEST_REJECT_PORTABLE==='1' && args.some(a=>String(a).endsWith('-portable.exe')))throw new Error('Portable signature rejected');};
require('node:module').syncBuiltinESMExports();
import(${JSON.stringify(moduleUrl)}).catch(e=>{console.error(e.message);process.exitCode=1;});`;
    const run = (reject) =>
      execFileSync(process.execPath, ["-e", bootstrap], {
        cwd: dir,
        env: { ...process.env, HRIG_TEST_REJECT_PORTABLE: reject ? "1" : "0" },
        windowsHide: true,
        encoding: "utf8",
        stdio: "pipe",
      });
    run(false);
    const calls = (await fs.readFile(path.join(dir, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(calls.length, 3);
    assert.ok(
      calls.every(
        (c) =>
          c.file === "powershell.exe" && c.args.includes("Fixture publisher"),
      ),
    );
    // macOS resolves /var temp directories to /private/var in child-process cwd.
    const portableArgs = calls.flatMap(c => c.args).filter(a => typeof a === "string" && a.endsWith("-portable.exe"));
    assert.equal(portableArgs.length, 1);
    assert.equal(await fs.realpath(portableArgs[0]), await fs.realpath(path.join(release, portable)));
    const evidence = path.join(release, "distribution-qa-win32-x64.json");
    await fs.unlink(evidence);
    assert.throws(() => run(true), /Portable signature rejected/);
    await assert.rejects(() => fs.access(evidence));
  } finally {
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error("Unexpected signing test cleanup path");
    await fs.rm(dir, { recursive: true, force: true });
  }
});
