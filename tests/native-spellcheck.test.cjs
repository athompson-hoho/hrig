const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_DICTIONARY_URL, INERT_DICTIONARY_URL, pickLanguage, applySpellcheck, registerSpellcheck } = require("../electron/spellcheck.cjs");

function fakeSession(available) {
  const calls = [];
  return {
    calls,
    availableSpellCheckerLanguages: available,
    setSpellCheckerDictionaryDownloadURL: (v) => calls.push(["url", v]),
    setSpellCheckerEnabled: (v) => calls.push(["enabled", v]),
    setSpellCheckerLanguages: (v) => calls.push(["languages", v]),
  };
}

test("pickLanguage prefers the exact locale, then its base language, then en-US, else none", () => {
  const list = ["en-US", "de", "fr-CA", "fr"];
  assert.equal(pickLanguage("fr-CA", list), "fr-CA");
  assert.equal(pickLanguage("de-AT", list), "de");
  assert.equal(pickLanguage("fr-FR", list), "fr-CA");
  assert.equal(pickLanguage("ja", list), "en-US");
  assert.equal(pickLanguage("ja", ["de"]), null);
  assert.equal(pickLanguage(undefined, []), null);
  assert.equal(pickLanguage("en_GB", ["en-GB"]), "en-GB");
  assert.equal(pickLanguage("en-US", "not-an-array"), null);
});

test("off clears the language so no dictionary is requested", () => {
  const s = fakeSession(["en-US"]);
  assert.deepEqual(applySpellcheck(s, false, { platform: "linux", locale: "en-US" }), { enabled: false, language: null });
  assert.deepEqual(s.calls, [["url", INERT_DICTIONARY_URL], ["languages", []], ["enabled", false]]);
});

test("on sets exactly one language before enabling (Windows/Linux)", () => {
  const s = fakeSession(["en-US", "de"]);
  assert.deepEqual(applySpellcheck(s, true, { platform: "win32", locale: "de-DE" }), { enabled: true, language: "de" });
  assert.deepEqual(s.calls, [["url", DEFAULT_DICTIONARY_URL], ["languages", ["de"]], ["enabled", true]]);
});

test("on without any available language stays off", () => {
  const s = fakeSession([]);
  assert.deepEqual(applySpellcheck(s, true, { platform: "linux", locale: "en-US" }), { enabled: false, language: null });
  assert.ok(!s.calls.some((c) => c[0] === "enabled" && c[1] === true));
});

test("macOS uses the system checker without setting a language", () => {
  const s = fakeSession(["en-US"]);
  assert.deepEqual(applySpellcheck(s, true, { platform: "darwin", locale: "en-US" }), { enabled: true, language: "system" });
  assert.deepEqual(s.calls, [["enabled", true]]);
});

test("applySpellcheck rejects non-booleans and tolerates a missing session", () => {
  for (const v of ["true", 1, 0, null, undefined, {}, []])
    assert.throws(() => applySpellcheck(fakeSession(["en-US"]), v, {}));
  assert.deepEqual(applySpellcheck(null, true, {}), { enabled: false, language: null });
});

test("OFF-state session config is provably network-inert; ON restores the real URL; OFF again re-blocks", () => {
  assert.equal(new URL(INERT_DICTIONARY_URL).hostname, "127.0.0.1");
  assert.match(DEFAULT_DICTIONARY_URL, /^https:\/\//);
  assert.notEqual(INERT_DICTIONARY_URL, DEFAULT_DICTIONARY_URL);
  const state = { url: null, languages: ["en-US"], enabled: true };
  const s = {
    availableSpellCheckerLanguages: ["en-US"],
    setSpellCheckerDictionaryDownloadURL: (v) => { state.url = v; },
    setSpellCheckerLanguages: (v) => { state.languages = v; },
    setSpellCheckerEnabled: (v) => { state.enabled = v; },
  };
  const env = { platform: "linux", locale: "en-US" };
  applySpellcheck(s, false, env);
  assert.deepEqual(state, { url: INERT_DICTIONARY_URL, languages: [], enabled: false });
  applySpellcheck(s, true, env);
  assert.deepEqual(state, { url: DEFAULT_DICTIONARY_URL, languages: ["en-US"], enabled: true });
  applySpellcheck(s, false, env);
  assert.deepEqual(state, { url: INERT_DICTIONARY_URL, languages: [], enabled: false });
});

test("a session created while the setting is off is configured inert immediately", () => {
  const s = fakeSession(["en-US"]);
  const handlers = {};
  registerSpellcheck({
    app: { whenReady: () => new Promise(() => {}), getLocale: () => "en-US", on: (ev, fn) => { handlers[ev] = fn; } },
    ipcMain: { handle() {} },
    getSession: () => s,
    trusted() {},
    platform: "linux",
  });
  handlers["session-created"](s);
  assert.deepEqual(s.calls, [["url", INERT_DICTIONARY_URL], ["languages", []], ["enabled", false]]);
});

test("registerSpellcheck starts off, and the IPC takes exactly one boolean from the trusted window", async () => {
  const s = fakeSession(["en-US"]);
  let ready;
  const handlers = {};
  registerSpellcheck({
    app: { whenReady: () => new Promise((r) => { ready = r; }), getLocale: () => "en-US", on() {} },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    getSession: () => s,
    trusted: (e) => { if (e.bad) throw new Error("untrusted"); },
    platform: "linux",
  });
  assert.deepEqual(s.calls, []);
  ready();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(s.calls, [["url", INERT_DICTIONARY_URL], ["languages", []], ["enabled", false]]);
  const h = handlers["spellcheck:set"];
  assert.deepEqual(h({}, true), { enabled: true, language: "en-US" });
  assert.throws(() => h({ bad: true }, true), /untrusted/);
  assert.throws(() => h({}, "yes"));
  assert.throws(() => h({}));
  assert.throws(() => h({}, true, true));
});

test("the setting is opt-in, documented, and wired through preload, types, App and main", () => {
  const root = path.join(__dirname, "..");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const { buildSync } = require("esbuild");
  const Module = require("node:module");
  const file = path.join(root, "src/settings.ts");
  const built = buildSync({ entryPoints: [file], bundle: true, platform: "node", format: "cjs", write: false });
  const mod = new Module(file, module);
  mod._compile(built.outputFiles[0].text, file);
  const settings = mod.exports;
  assert.equal(settings.defaults["workspace.nativeSpellcheck"], false);
  const rows = settings.schema.filter((r) => r.key === "workspace.nativeSpellcheck");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Workspace");
  assert.deepEqual(settings.validateOverrides({ "workspace.nativeSpellcheck": true }), { "workspace.nativeSpellcheck": true });
  for (const v of ["true", 1, null, {}]) assert.throws(() => settings.validateOverrides({ "workspace.nativeSpellcheck": v }));
  assert.match(read("SETTINGS.md"), /`workspace\.nativeSpellcheck` \| `false`/);
  assert.match(read("PRIVACY.md"), /Spellcheck \(opt-in, off by default\)/);
  assert.match(read("electron/preload.cjs"), /setSpellcheck: invoke\('spellcheck:set'\)/);
  assert.match(read("src/types.ts"), /setSpellcheck\(enabled: boolean\)/);
  const app = read("src/App.tsx");
  assert.match(app, /const wanted = preferences\["workspace\.nativeSpellcheck"\] === true;/);
  assert.match(app, /\.setSpellcheck\(wanted\)/);
  const main = read("electron/main.cjs");
  assert.match(main, /registerSpellcheck\(/);
  assert.ok(main.indexOf("registerSpellcheck(") < main.indexOf("app.whenReady().then(createWindow)"));
});
