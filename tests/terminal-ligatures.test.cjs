const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const settings = (() => {
  const entry = path.join(root, "src/settings.ts");
  const built = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false,
  });
  const loaded = new Module(entry, module);
  loaded._compile(built.outputFiles[0].text, entry);
  return loaded.exports;
})();

test("terminal ligatures are an off-by-default typed setting exposed in Settings and documented", () => {
  const key = "terminal.ligatures";
  assert.equal(settings.defaults[key], false);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Terminal");
  assert.equal(rows[0].label, "Font ligatures");
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [key]: value }), { [key]: value });
  for (const value of ["true", 1, null, {}])
    assert.throws(() => settings.validateOverrides({ [key]: value }));
  assert.match(read("src/SettingsPage.tsx"), /schema/);
  assert.match(read("electron/main.cjs"), /registerLocalFontsPermission\(/);
  assert.match(read("SETTINGS.md"), /\| `terminal\.ligatures` \| `false` \|/);
  assert.match(read("TERMINALS.md"), /terminal\.ligatures/);
  assert.match(read("PRIVACY.md"), /local font/i);
});

test("terminal addon is dynamically imported only for enabled terminals and disposed on disable or terminal teardown", () => {
  const source = read("src/TerminalPanel.tsx");
  assert.doesNotMatch(source, /import\s+\{?\s*LigaturesAddon\s*\}?\s+from/);
  const disabledGate = source.indexOf('if (!preferences["terminal.ligatures"])');
  const lazyImport = source.indexOf('import("@xterm/addon-ligatures")');
  assert.ok(disabledGate >= 0, "off setting returns before the addon load effect");
  assert.ok(lazyImport > disabledGate, "dynamic import follows the enabled-setting gate");
  assert.match(source, /new LigaturesAddon\(\)/);
  assert.match(source, /term\.loadAddon\(addon\)/);
  assert.match(source, /ligaturesAddonRef\.current\?\.dispose\(\)/);
  assert.match(source, /preferences\["terminal\.fontFamily"\]/);
});

test("local-font permission is explicitly decided for the trusted app window and denied by default", async () => {
  const { registerLocalFontsPermission } = require("../electron/local-fonts-permission.cjs");
  const makeHarness = (response) => {
    const calls = { prompts: 0 };
    let permissionCheck;
    let permissionRequest;
    const trustedContents = {};
    const window = { webContents: trustedContents, isDestroyed: () => false };
    const session = {
      setPermissionCheckHandler(fn) { permissionCheck = fn; },
      setPermissionRequestHandler(fn) { permissionRequest = fn; },
    };
    const dialog = {
      async showMessageBox(owner, options) {
        calls.prompts++;
        calls.owner = owner;
        calls.options = options;
        return { response };
      },
    };
    registerLocalFontsPermission({ session, dialog, getWindow: () => window });
    const request = (contents, permission) => new Promise((resolve) => {
      permissionRequest(contents, permission, resolve, {});
    });
    return { calls, permissionCheck, request, trustedContents, window };
  };

  const allowed = makeHarness(1);
  assert.equal(allowed.permissionCheck(allowed.trustedContents, "local-fonts"), false);
  assert.equal(allowed.permissionCheck(allowed.trustedContents, "notifications"), false);
  assert.equal(await allowed.request({}, "local-fonts"), false, "untrusted contents are denied");
  assert.equal(await allowed.request(allowed.trustedContents, "notifications"), false, "other permissions are denied");
  assert.equal(allowed.calls.prompts, 0, "irrelevant requests never prompt");
  assert.equal(await allowed.request(allowed.trustedContents, "local-fonts"), true, "explicit Allow is honored");
  assert.equal(allowed.calls.owner, allowed.window);
  assert.deepEqual(allowed.calls.options.buttons, ["Not now", "Allow while HRig is open"]);
  assert.match(allowed.calls.options.detail, /not sent|never sent/i);
  assert.equal(allowed.permissionCheck(allowed.trustedContents, "local-fonts"), true);
  assert.equal(await allowed.request(allowed.trustedContents, "local-fonts"), true);
  assert.equal(allowed.calls.prompts, 1, "the session decision is reused");

  const denied = makeHarness(0);
  assert.equal(await denied.request(denied.trustedContents, "local-fonts"), false);
  assert.equal(denied.permissionCheck(denied.trustedContents, "local-fonts"), false);
  assert.equal(await denied.request(denied.trustedContents, "local-fonts"), false);
  assert.equal(denied.calls.prompts, 1, "denial is remembered for this app session");
});
