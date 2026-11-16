const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function load(source) {
  const file = path.join(root, source);
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const compiled = new Module(file, module);
  compiled.filename = file;
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(built.outputFiles[0].text, file);
  return compiled.exports;
}

const fillers = [
  0x3164,
  0x115f,
  0x1160,
  0xffa0,
  0x2800,
  0x00ad,
  0x034f,
  0x180e,
  0xfff9,
  0xfffa,
  0xfffb,
  ...Array.from({ length: 0x80 }, (_, index) => 0xe0000 + index),
].map((point) => String.fromCodePoint(point));
const fillerRun = fillers.join("");
const joinedEmoji = "👩‍👩‍👧‍👦";

const visibleText = load("src/visible-text.ts");

test("shared visible text cleaner strips every approved filler, including astral tag code points, and preserves ZWJ", () => {
  assert.equal(visibleText.stripInvisibleFillers(`before${fillerRun}after`), "beforeafter");
  assert.equal(visibleText.stripInvisibleFillers(joinedEmoji), joinedEmoji);
  const high = String.fromCharCode(0xd83d);
  const low = String.fromCharCode(0xdc00);
  assert.equal(visibleText.stripInvisibleFillers(`a${high}\u3164${low}b`), "ab");
  assert.equal(visibleText.stripInvisibleFillers(`a${high}${low}b`), `a🐀b`);
});

test("markdown preview strips fillers while retaining joined emoji", () => {
  const { parseMarkdown } = load("src/markdown-safe.ts");
  const result = parseMarkdown(`Name${fillerRun} ${joinedEmoji}`);
  assert.equal(result.blocks[0].children[0].text, `Name ${joinedEmoji}`);
});

test("panel and native window titles strip fillers and preserve joined emoji", () => {
  const { normalizeTitle } = load("src/panel-title.ts");
  const { buildWindowTitle } = load("src/window-title.ts");
  const { windowTitle } = require(path.join(root, "electron/window-title.cjs"));
  assert.equal(normalizeTitle(`Panel${fillerRun} ${joinedEmoji}`), `Panel ${joinedEmoji}`);
  assert.equal(
    buildWindowTitle({ enabled: true, panel: `Panel${fillerRun} ${joinedEmoji}` }),
    `Panel ${joinedEmoji} - hRig`,
  );
  assert.equal(windowTitle(`Panel${fillerRun} - hRig`), "Panel - hRig");
});

test("seat notes and terminal paste previews strip fillers but retain joined emoji", () => {
  const { cleanNote } = load("src/seat-notes.ts");
  const { previewOf } = load("src/terminal-paste-history.ts");
  assert.equal(cleanNote(`Note${fillerRun} ${joinedEmoji}`), `Note ${joinedEmoji}`);
  assert.equal(previewOf(`Paste${fillerRun} ${joinedEmoji}`).text, `Paste ${joinedEmoji}`);
});

test("task drafts strip fillers before subject and body are shown", () => {
  const { draftFromSelection } = load("src/task-draft.ts");
  const draft = draftFromSelection(`Task${fillerRun} ${joinedEmoji}`);
  assert.equal(draft.ok, true);
  assert.equal(draft.subject, `Task ${joinedEmoji}`);
  assert.equal(draft.body, `Task ${joinedEmoji}`);
});

test("seat and pod broadcast labels render without fillers and stay ineligible if their wire identity changed", () => {
  const { podGroups } = load("src/pod-broadcast.ts");
  const groups = podGroups([
    {
      id: "seat-1",
      rigId: "rig-1",
      rigName: `Rig${fillerRun}`,
      name: `Bot${fillerRun}`,
      pod: `Pod${fillerRun}`,
      runtime: "codex",
      status: "running",
      session: "bot@hrig",
    },
  ]);
  assert.equal(groups[0].rigName, "Rig");
  assert.equal(groups[0].pod, "Pod");
  assert.equal(groups[0].seats[0].name, "Bot");
  assert.equal(groups[0].seats[0].blocked, "unsafe name");
});

test("seat/pod broadcast text sends the cleaned text and preserves joined emoji", () => {
  const { validateBroadcastText } = load("src/pod-broadcast.ts");
  assert.deepEqual(validateBroadcastText(`Hi${fillerRun} ${joinedEmoji}`), {
    ok: true,
    text: `Hi ${joinedEmoji}`,
  });
  assert.deepEqual(validateBroadcastText(`${fillerRun}`), {
    ok: false,
    reason: "empty",
  });
});
