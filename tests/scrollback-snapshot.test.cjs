const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");

const built = buildSync({
  entryPoints: ["src/scrollback-snapshot.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = new Module("scrollback-snapshot", module);
mod.paths = module.paths;
mod._compile(built.outputFiles[0].text, "scrollback-snapshot");
const { boundSnapshot } = mod.exports;

const bytes = (text) => Buffer.byteLength(text, "utf8");
const big = { maxLines: 1000, maxBytes: 1_000_000 };

test("text within both caps comes back unchanged and is not truncated", () => {
  const text = "one\ntwo\nthree\n";
  assert.deepEqual(boundSnapshot(text, big), { text, truncated: false });
  assert.deepEqual(
    boundSnapshot(text, { maxLines: 3, maxBytes: bytes(text) }),
    {
      text,
      truncated: false,
    },
  );
});

test("the line cap keeps the newest whole lines", () => {
  assert.deepEqual(boundSnapshot("a\nb\nc\nd\n", { ...big, maxLines: 2 }), {
    text: "c\nd\n",
    truncated: true,
  });
  // A last line without a terminator is a line; a trailing LF does not add one.
  assert.deepEqual(boundSnapshot("a\nb\nc", { ...big, maxLines: 2 }), {
    text: "b\nc",
    truncated: true,
  });
  assert.deepEqual(boundSnapshot("a\nb\nc\n", { ...big, maxLines: 3 }), {
    text: "a\nb\nc\n",
    truncated: false,
  });
  assert.equal(
    boundSnapshot("a\n\n\nb\n", { ...big, maxLines: 2 }).text,
    "\nb\n",
  );
});

test("the byte cap keeps whole lines and never counts an excluded line", () => {
  const text = "aaaa\nbbbb\ncccc\n"; // 5 bytes a line
  assert.deepEqual(boundSnapshot(text, { ...big, maxBytes: 10 }), {
    text: "bbbb\ncccc\n",
    truncated: true,
  });
  assert.deepEqual(boundSnapshot(text, { ...big, maxBytes: 14 }), {
    text: "bbbb\ncccc\n",
    truncated: true,
  });
  assert.deepEqual(boundSnapshot(text, { ...big, maxBytes: 15 }), {
    text,
    truncated: false,
  });
});

test("both caps apply and the tighter one wins", () => {
  const text = "aa\nbb\ncc\ndd\n";
  assert.equal(
    boundSnapshot(text, { maxLines: 3, maxBytes: 6 }).text,
    "cc\ndd\n",
  );
  assert.equal(
    boundSnapshot(text, { maxLines: 1, maxBytes: 100 }).text,
    "dd\n",
  );
});

test("CRLF counts as one line break and the pair is never split", () => {
  const text = "a\r\nb\r\nc\r\n";
  assert.deepEqual(boundSnapshot(text, { ...big, maxLines: 2 }), {
    text: "b\r\nc\r\n",
    truncated: true,
  });
  assert.equal(boundSnapshot(text, { ...big, maxBytes: 7 }).text, "b\r\nc\r\n");
  // A lone CR is not a line break: this is one line.
  assert.deepEqual(boundSnapshot("a\rb\rc", { ...big, maxLines: 1 }), {
    text: "a\rb\rc",
    truncated: false,
  });
  // A single over-long CRLF line cut by bytes does not start with an orphan LF.
  const cut = boundSnapshot("abcdef\r\n", { ...big, maxBytes: 3 });
  assert.ok(!cut.text.startsWith("\n"));
  assert.ok(bytes(cut.text) <= 3);
  assert.equal(cut.truncated, true);
});

test("multi-byte text is counted in UTF-8 bytes, not characters", () => {
  const text = "éé\n€€\n"; // 4 + 1 and 6 + 1 bytes
  assert.equal(bytes(text), 12);
  assert.equal(boundSnapshot(text, { ...big, maxBytes: 12 }).truncated, false);
  assert.deepEqual(boundSnapshot(text, { ...big, maxBytes: 11 }), {
    text: "€€\n",
    truncated: true,
  });
  // Not even the last line fits: it is cut at a character boundary, never mid-character.
  assert.equal(boundSnapshot(text, { ...big, maxBytes: 6 }).text, "\u20ac\n");
  assert.equal(boundSnapshot(text, { ...big, maxBytes: 2 }).text, "\n");
});

test("a line longer than the byte cap is cut on a code point boundary, never mid-character", () => {
  const euros = "€".repeat(10); // 3 bytes each
  for (let cap = 1; cap <= 31; cap++) {
    const r = boundSnapshot("old\n" + euros, { ...big, maxBytes: cap });
    assert.ok(bytes(r.text) <= cap, "cap " + cap);
    assert.equal(r.text, "€".repeat(Math.floor(cap / 3)), "cap " + cap);
    assert.equal(r.truncated, true);
    assert.ok(!r.text.includes("�"));
    assert.ok(!r.text.includes("old"), "never crosses into an earlier line");
  }
  // Surrogate pairs (4 bytes) are kept or dropped whole.
  const emoji = "\u{1F600}".repeat(5);
  for (let cap = 1; cap <= 21; cap++) {
    const r = boundSnapshot(emoji, { ...big, maxBytes: cap });
    assert.equal(r.text, "\u{1F600}".repeat(Math.floor(cap / 4)), "cap " + cap);
    assert.ok(bytes(r.text) <= cap);
  }
  // Prefer whole lines: a long older line is dropped, not cut, when the newest fits.
  assert.deepEqual(boundSnapshot(euros + "\nend\n", { ...big, maxBytes: 8 }), {
    text: "end\n",
    truncated: true,
  });
});

test("empty and non-string input give an empty result and never throw", () => {
  assert.deepEqual(boundSnapshot("", big), { text: "", truncated: false });
  for (const value of [undefined, null, 5, {}, [], () => 1, Symbol("x"), 10n])
    assert.deepEqual(boundSnapshot(value, big), { text: "", truncated: false });
  assert.deepEqual(boundSnapshot("\n", big), { text: "\n", truncated: false });
});

test("caps that are not positive numbers keep nothing instead of everything, and never throw", () => {
  const text = "a\nb\n";
  for (const bad of [
    0,
    -1,
    -Infinity,
    NaN,
    undefined,
    null,
    "5",
    {},
    [],
    0.5,
  ]) {
    assert.deepEqual(boundSnapshot(text, { maxLines: bad, maxBytes: 100 }), {
      text: "",
      truncated: true,
    });
    assert.deepEqual(boundSnapshot(text, { maxLines: 100, maxBytes: bad }), {
      text: "",
      truncated: true,
    });
  }
  for (const caps of [undefined, null, {}, 5, "x"])
    assert.deepEqual(boundSnapshot(text, caps), { text: "", truncated: true });
  // Fractions round down; Infinity means no limit for that cap.
  assert.equal(
    boundSnapshot(text, { maxLines: 1.9, maxBytes: 100 }).text,
    "b\n",
  );
  assert.equal(
    boundSnapshot(text, { maxLines: Infinity, maxBytes: Infinity }).text,
    text,
  );
  // A getter that throws is contained.
  const hostile = {
    get maxLines() {
      throw new Error("boom");
    },
    maxBytes: 5,
  };
  assert.deepEqual(boundSnapshot(text, hostile), { text: "", truncated: true });
});

test("the result is always a tail of the input within both caps", () => {
  const alphabet = ["a", "é", "€", "\u{1F600}", "\n", "\r\n", "\r", " "];
  let seed = 7;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let round = 0; round < 400; round++) {
    let text = "";
    for (let i = next(40); i > 0; i--) text += alphabet[next(alphabet.length)];
    const maxLines = 1 + next(6);
    const maxBytes = 1 + next(40);
    const r = boundSnapshot(text, { maxLines, maxBytes });
    assert.ok(text.endsWith(r.text), "tail of the input");
    assert.ok(bytes(r.text) <= maxBytes, "byte cap");
    assert.equal(r.truncated, r.text.length < text.length);
    assert.ok(!r.text.includes("�"));
    const lineCount =
      r.text === "" ? 0 : r.text.replace(/\n$/, "").split("\n").length;
    assert.ok(lineCount <= maxLines, "line cap");
  }
});

test("the helper is inert: no app source imports it and no setting names it", () => {
  const root = path.join(__dirname, "..");
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|cjs|mjs|js|jsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, "src"));
  walk(path.join(root, "electron"));
  assert.ok(files.length > 20, "found the sources");
  for (const file of files) {
    if (path.basename(file) === "scrollback-snapshot.ts") continue;
    assert.ok(
      !fs.readFileSync(file, "utf8").includes("scrollback-snapshot"),
      path.relative(root, file) + " must not import scrollback-snapshot",
    );
  }
  const settings = fs.readFileSync(path.join(root, "src/settings.ts"), "utf8");
  assert.ok(
    !/persistScrollback/.test(settings),
    "no persistScrollback setting",
  );
});

test("the design note exists, is marked as not implemented and names the helper's caps", () => {
  const note = fs.readFileSync(
    path.join(__dirname, "..", "docs/terminal-scrollback-persistence.md"),
    "utf8",
  );
  assert.match(note, /Design note only; not implemented\./);
  for (const heading of [
    "## Goal",
    "## Current behavior",
    "## Risks",
    "## Options",
    "## Recommendation",
    "## Approval gate",
    "## Tests an implementation must add",
  ])
    assert.ok(note.includes(heading), "note has " + heading);
  assert.ok(note.includes("boundSnapshot"));
  assert.ok(!/[^\n -~]/.test(note), "the note is printable ASCII");
  assert.ok(note.endsWith("\n") && !note.endsWith("\n\n"));
});
