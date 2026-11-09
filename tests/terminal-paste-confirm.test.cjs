const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");

function load(file) {
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const mod = new Module(file, module);
  mod._compile(built.outputFiles[0].text, file);
  return mod.exports;
}

const paste = load("src/terminal-paste.ts");
const settings = load("src/settings.ts");
const {
  pasteClipboard,
  lineCount,
  needsConfirmation,
  endsWithLineBreak,
  pastePreview,
  PASTE_PREVIEW_MAX_LINES,
  PASTE_PREVIEW_MAX_LINE_CHARS,
} = paste;

const KEY = "terminal.confirmMultilinePaste";

// Fake actions: every clipboard function is hand-built and records its calls.
function makeActions({ text = "", image = false, confirm, confirmEnabled } = {}) {
  const calls = { read: 0, hasImage: 0, pasteText: [], pasteImage: 0 };
  const actions = {
    readText: async () => {
      calls.read += 1;
      return text;
    },
    hasImage: async () => {
      calls.hasImage += 1;
      return image;
    },
    pasteText: (value) => calls.pasteText.push(value),
    pasteImage: async () => {
      calls.pasteImage += 1;
    },
  };
  if (confirm !== undefined) actions.confirm = confirm;
  if (confirmEnabled !== undefined) actions.confirmEnabled = confirmEnabled;
  return { actions, calls };
}

function makeHook(answer) {
  const asked = [];
  const hook = async (text, lines) => {
    asked.push([text, lines]);
    return typeof answer === "function" ? answer(text, lines) : answer;
  };
  return { hook, asked };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("L1 lineCount counts CRLF, CR and LF as one break each", () => {
  assert.equal(lineCount("a\nb"), 2);
  assert.equal(lineCount("a\r\nb"), 2);
  assert.equal(lineCount("a\rb"), 2);
  assert.equal(lineCount("a\r\nb\rc\nd"), 4);
  assert.equal(lineCount("a\n\nb"), 3);
});

test("L2 lineCount ignores one trailing break", () => {
  assert.equal(lineCount("a\n"), 1);
  assert.equal(lineCount("a\r\n"), 1);
  assert.equal(lineCount("a\r"), 1);
  assert.equal(lineCount("a\nb\n"), 2);
  assert.equal(lineCount("a\n\n"), 2);
  assert.equal(lineCount("\n"), 1);
  assert.equal(lineCount("\n\n"), 2);
  assert.equal(lineCount("\r\n\r\n"), 2);
});

test("L3 lineCount degenerate inputs", () => {
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("x"), 1);
  assert.equal(lineCount(" "), 1);
});

test("L4 lineCount stays a cheap single pass on very large text", () => {
  const many = "x\n".repeat(200000);
  assert.equal(lineCount(many), 200000);
  assert.equal(lineCount(many + "y"), 200001);
  assert.equal(lineCount("x".repeat(5000000)), 1);
});

test("N1 needsConfirmation is true for any CR or LF when enabled", () => {
  assert.equal(needsConfirmation(false, "a\n".repeat(100)), false);
  assert.equal(needsConfirmation(false, "a"), false);
  for (const text of ["", " ", "a", "ls -la"]) {
    assert.equal(needsConfirmation(true, text), false, JSON.stringify(text));
  }
  for (const text of ["a\n", "a\r\n", "a\r", "\n", "a\nb", "a\r\nb", "a\rb", "a\n\n", "\n\n"]) {
    assert.equal(needsConfirmation(true, text), true, JSON.stringify(text));
  }
  assert.equal(needsConfirmation(true, "x".repeat(5000000)), false);
  assert.equal(needsConfirmation(true, "x".repeat(5000000) + "\n"), true);
});

test("E1 endsWithLineBreak reports a trailing CR or LF", () => {
  for (const text of ["ls\n", "ls\r\n", "a\r", "\n"]) {
    assert.equal(endsWithLineBreak(text), true, JSON.stringify(text));
  }
  for (const text of ["", "ls", "a\nb"]) {
    assert.equal(endsWithLineBreak(text), false, JSON.stringify(text));
  }
});

test("V1 pastePreview normalises breaks and keeps up to 8 lines", () => {
  assert.equal(PASTE_PREVIEW_MAX_LINES, 8);
  assert.equal(PASTE_PREVIEW_MAX_LINE_CHARS, 200);
  assert.equal(pastePreview(""), "");
  assert.equal(pastePreview("a\r\nb\rc\n"), "a\nb\nc");
  const eight = ["1", "2", "3", "4", "5", "6", "7", "8"];
  assert.equal(pastePreview(eight.join("\n")), eight.join("\n"));
  assert.equal(pastePreview(eight.join("\n") + "\n"), eight.join("\n"));
  assert.equal(pastePreview("a\n\nb"), "a\n\nb");
});

test("V2 pastePreview cuts extra lines and long lines with an ellipsis", () => {
  const nine = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const expected = nine.slice(0, 8).join("\n") + "\n…";
  assert.equal(pastePreview(nine.join("\n")), expected);
  assert.equal(pastePreview(nine.join("\n") + "\n"), expected);
  assert.equal(pastePreview("x".repeat(200)), "x".repeat(200));
  assert.equal(pastePreview("x".repeat(201)), "x".repeat(200) + "…");
  assert.equal(pastePreview("x\n".repeat(1000000)), "x\n".repeat(8) + "…");
  assert.equal(pastePreview("x".repeat(5000000)), "x".repeat(200) + "…");
});

test("T1 tracer: the resolved setting drives a single exact confirmed paste", async () => {
  assert.equal(settings.resolveSettings()[KEY], false);
  assert.equal(settings.resolveSettings({ [KEY]: true })[KEY], true);
  assert.equal(settings.resolveSettings({ [KEY]: true }, { [KEY]: false })[KEY], false);
  const text = "a\nb\nc";
  const run = async (user, project, answer) => {
    const resolved = settings.resolveSettings(user, project)[KEY];
    const { hook, asked } = makeHook(answer);
    const { actions, calls } = makeActions({
      text,
      confirm: hook,
      confirmEnabled: resolved,
    });
    await pasteClipboard(actions);
    return { asked, calls };
  };
  let r = await run(undefined, undefined, true);
  assert.deepEqual(r.asked, []);
  assert.deepEqual(r.calls.pasteText, [text]);
  r = await run({ [KEY]: true }, undefined, true);
  assert.deepEqual(r.asked, [[text, 3]]);
  assert.deepEqual(r.calls.pasteText, [text]);
  r = await run({ [KEY]: true }, undefined, false);
  assert.deepEqual(r.asked, [[text, 3]]);
  assert.deepEqual(r.calls.pasteText, []);
  r = await run({ [KEY]: true }, { [KEY]: false }, true);
  assert.deepEqual(r.asked, []);
  assert.deepEqual(r.calls.pasteText, [text]);
});

test("C1 confirmed paste is exact and happens only after the answer", async () => {
  const text = "one\r\ntwo\r\nthree\n";
  const gate = deferred();
  const { hook, asked } = makeHook(() => gate.promise);
  const { actions, calls } = makeActions({ text, confirm: hook, confirmEnabled: true });
  const done = pasteClipboard(actions);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.pasteText, []);
  assert.deepEqual(asked, [[text, lineCount(text)]]);
  gate.resolve(true);
  await done;
  assert.deepEqual(calls.pasteText, [text]);
  assert.equal(calls.read, 1);
  assert.equal(calls.hasImage, 0);
  assert.equal(calls.pasteImage, 0);
});

test("C2 a declined paste sends nothing and does not throw", async () => {
  const { hook } = makeHook(false);
  const { actions, calls } = makeActions({ text: "a\nb", image: true, confirm: hook, confirmEnabled: true });
  await pasteClipboard(actions);
  assert.deepEqual(calls.pasteText, []);
  assert.equal(calls.hasImage, 0);
  assert.equal(calls.pasteImage, 0);
});

test("C3 only the boolean true proceeds", async () => {
  for (const answer of [undefined, null, 0, "", "yes", 1]) {
    const { hook } = makeHook(answer);
    const { actions, calls } = makeActions({ text: "a\nb", confirm: hook, confirmEnabled: true });
    await pasteClipboard(actions);
    assert.deepEqual(calls.pasteText, [], String(answer));
  }
});

test("C4 a failing hook rejects and pastes nothing", async () => {
  const boom = new Error("boom");
  const rejecting = makeActions({
    text: "a\nb",
    confirm: () => Promise.reject(boom),
    confirmEnabled: true,
  });
  await assert.rejects(pasteClipboard(rejecting.actions), (e) => e === boom);
  assert.deepEqual(rejecting.calls.pasteText, []);
  const throwing = makeActions({
    text: "a\nb",
    confirm: () => {
      throw boom;
    },
    confirmEnabled: true,
  });
  await assert.rejects(pasteClipboard(throwing.actions), (e) => e === boom);
  assert.deepEqual(throwing.calls.pasteText, []);
});

test("C5 behaviour around the prompt", async () => {
  // No hook: pastes immediately.
  let m = makeActions({ text: "a\nb\n" });
  await pasteClipboard(m.actions);
  assert.deepEqual(m.calls.pasteText, ["a\nb\n"]);
  // Hook present, setting omitted or false: never asked.
  for (const confirmEnabled of [undefined, false]) {
    const { hook, asked } = makeHook(true);
    m = makeActions({ text: "a\nb", confirm: hook, confirmEnabled });
    await pasteClipboard(m.actions);
    assert.deepEqual(asked, []);
    assert.deepEqual(m.calls.pasteText, ["a\nb"]);
  }
  // Enabled: no line break is never asked.
  {
    const { hook, asked } = makeHook(true);
    m = makeActions({ text: "ls -la", confirm: hook, confirmEnabled: true });
    await pasteClipboard(m.actions);
    assert.deepEqual(asked, []);
    assert.deepEqual(m.calls.pasteText, ["ls -la"]);
  }
  // Enabled: a single trailing break is asked, with 1 line, and ordered.
  for (const text of ["ls\n", "ls\r\n"]) {
    const gate = deferred();
    const { hook, asked } = makeHook(() => gate.promise);
    m = makeActions({ text, confirm: hook, confirmEnabled: true });
    const done = pasteClipboard(m.actions);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(asked, [[text, 1]]);
    assert.deepEqual(m.calls.pasteText, []);
    gate.resolve(true);
    await done;
    assert.deepEqual(m.calls.pasteText, [text]);
  }
  {
    const { hook } = makeHook(false);
    m = makeActions({ text: "ls\n", confirm: hook, confirmEnabled: true });
    await pasteClipboard(m.actions);
    assert.deepEqual(m.calls.pasteText, []);
  }
});

test("C6 image and empty clipboards never reach the hook", async () => {
  {
    const { hook, asked } = makeHook(true);
    const m = makeActions({ text: "", image: true, confirm: hook, confirmEnabled: true });
    await pasteClipboard(m.actions);
    assert.deepEqual(asked, []);
    assert.equal(m.calls.pasteImage, 1);
    assert.deepEqual(m.calls.pasteText, []);
  }
  {
    const { hook, asked } = makeHook(true);
    const m = makeActions({ text: "", image: false, confirm: hook, confirmEnabled: true });
    await pasteClipboard(m.actions);
    assert.deepEqual(asked, []);
    assert.equal(m.calls.pasteImage, 0);
    assert.deepEqual(m.calls.pasteText, []);
  }
  {
    const { hook, asked } = makeHook(true);
    const m = makeActions({ text: "a\nb", image: true, confirm: hook, confirmEnabled: true });
    await pasteClipboard(m.actions);
    assert.equal(asked.length, 1);
    assert.deepEqual(m.calls.pasteText, ["a\nb"]);
    assert.equal(m.calls.pasteImage, 0);
  }
});
