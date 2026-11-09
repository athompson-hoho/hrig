"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const tight = (text) =>
  collapse(text)
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/, \}/g, " }");
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
const char = (code) => String.fromCharCode(code);

function bundle(entry, external = []) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external,
    logLevel: "silent",
  });
  return built.outputFiles[0].text;
}
function load(entry, fakes = {}) {
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod.require = (id) => (id in fakes ? fakes[id] : require(id));
  mod._compile(bundle(entry, Object.keys(fakes)), mod.filename);
  return mod.exports;
}
const vars = () => load("src/snippet-vars.ts");

// A small react runtime: useState keeps slots and a state change renders the dialog again at once.
function dialogHarness(extra = {}) {
  const slots = [];
  let cursor = 0;
  let tree = null;
  const calls = { inserted: [], changed: [], closed: 0 };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
          render();
        },
      ];
    },
  };
  const jsx = (type, props) => ({ type, props });
  const Dialog = load("src/TerminalSnippets.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "./components": { Modal: "Modal", ErrorBox: "ErrorBox" },
  }).default;
  const props = {
    name: "Prod",
    connection: "Prod DB",
    terminalId: "t1",
    snippets: [],
    context: { host: "prod-1" },
    onChange: (next) => calls.changed.push(next),
    onInsert: (text, run) => calls.inserted.push([text, run]),
    onClose: () => {
      calls.closed++;
    },
    ...extra,
  };
  function render() {
    cursor = 0;
    tree = Dialog(props);
  }
  render();
  const all = (node, out = []) => {
    if (Array.isArray(node)) node.forEach((n) => all(n, out));
    else if (node && typeof node === "object") {
      out.push(node);
      all(node.props && node.props.children, out);
    }
    return out;
  };
  const text = (node) =>
    Array.isArray(node)
      ? node.map(text).join("")
      : node && typeof node === "object"
        ? text(node.props && node.props.children)
        : typeof node === "string"
          ? node
          : "";
  const button = (label) =>
    all(tree).find(
      (n) =>
        n.type === "button" &&
        (label instanceof RegExp ? label.test(text(n)) : text(n) === label),
    );
  const status = () =>
    all(tree).find((n) => n.type === "div" && n.props.role === "status");
  return {
    calls,
    all: () => all(tree),
    text,
    button,
    status,
    errors: () => all(tree).filter((n) => n.type === "ErrorBox"),
    pre: () => all(tree).filter((n) => n.type === "pre"),
    typeCommand: (value) =>
      all(tree)
        .find((n) => n.type === "textarea")
        .props.onChange({ target: { value } }),
    typeName: (value) =>
      all(tree)
        .find((n) => n.type === "input")
        .props.onChange({ target: { value } }),
  };
}

test("snippet-vars tracer: a placeholder typed into the real Saved snippets dialog is previewed, then inserted expanded without Enter, and the saved snippet keeps its placeholders", () => {
  const v = vars();
  const connection = {
    id: "ssh:prod",
    name: "Prod DB",
    kind: "ssh",
    host: "prod-1",
    root: "/srv",
  };
  const context = v.snippetContext(connection, "/srv/apps/hrig/", {
    name: "dev.impl@rig-a",
  });
  assert.deepEqual(context, {
    host: "prod-1",
    seat: "dev.impl@rig-a",
    project: "hrig",
  });
  const raw = 'ssh {host} -t "tmux attach -t {seat}" # {project} {{host}}';
  const expected =
    'ssh prod-1 -t "tmux attach -t dev.impl@rig-a" # hrig {host}';

  // Nothing typed, or text with no placeholder: no preview block at all.
  const plain = dialogHarness({ context });
  assert.equal(plain.status(), undefined);
  assert.ok(
    plain
      .all()
      .some(
        (n) =>
          n.type === "p" &&
          n.props.className === "field-note" &&
          plain.text(n).includes("{host}, {seat} and {project}"),
      ),
    "the dialog always explains the placeholders",
  );
  plain.typeCommand("git status");
  assert.equal(plain.status(), undefined, "plain text needs no preview");
  plain.button("Insert").props.onClick();
  assert.deepEqual(plain.calls.inserted, [["git status", false]]);
  assert.equal(plain.calls.closed, 1);

  // The preview shows the exact text before Insert; the stored snippet is not touched by typing.
  const d = dialogHarness({ context });
  d.typeCommand(raw);
  assert.equal(d.pre().length, 1);
  assert.equal(d.pre()[0].props.children, expected);
  assert.ok(
    d.text(d.status()).includes("without pressing Enter"),
    "the preview says Insert does not press Enter",
  );
  assert.deepEqual(d.calls.inserted, [], "typing sends nothing");
  assert.deepEqual(d.calls.changed, [], "typing saves nothing");
  d.button("Insert").props.onClick();
  assert.deepEqual(d.calls.inserted, [[expected, false]]);
  assert.equal(d.calls.closed, 1);
  assert.deepEqual(d.calls.changed, []);
  assert.ok(!/[\r\n]/.test(d.calls.inserted[0][0]), "a single line, no Enter");

  // The run path keeps its review step and shows the expanded text; only the second click sends.
  const run = dialogHarness({ context });
  run.typeCommand(raw);
  run.button(/^Review insert and run/).props.onClick();
  assert.deepEqual(run.calls.inserted, [], "review sends nothing");
  assert.equal(run.calls.closed, 0);
  assert.equal(run.pre()[0].props.children, expected);
  run.button("Back").props.onClick();
  assert.deepEqual(run.calls.inserted, []);
  run.button(/^Review insert and run/).props.onClick();
  run.button("Insert and run").props.onClick();
  assert.deepEqual(run.calls.inserted, [[expected, true]]);
  assert.equal(run.calls.closed, 1);

  // Saving keeps the placeholders as typed (D-04: the stored text is raw).
  const save = dialogHarness({ context });
  save.typeCommand(raw);
  save.typeName("  attach  ");
  save.button("Save snippet").props.onClick();
  assert.equal(save.calls.changed.length, 1);
  const saved = save.calls.changed[0];
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "attach");
  assert.equal(saved[0].text, raw);
  assert.equal(typeof saved[0].id, "string");
  assert.deepEqual(save.calls.inserted, []);

  // A placeholder this terminal cannot fill: a message, no insert, the dialog stays open.
  const noSeat = dialogHarness({ context: { host: "prod-1" } });
  noSeat.typeCommand("tmux attach -t {seat}");
  assert.ok(
    noSeat.text(noSeat.status()).includes("{seat} is not available"),
    "the preview says why",
  );
  noSeat.button("Insert").props.onClick();
  noSeat.button(/^Review insert and run/).props.onClick();
  assert.deepEqual(noSeat.calls.inserted, []);
  assert.equal(noSeat.calls.closed, 0);
  assert.equal(noSeat.errors().length, 1);
  assert.ok(noSeat.errors()[0].props.error.includes("Nothing was sent"));

  // A value with a line break refuses and sends nothing.
  const bad = dialogHarness({ context: { host: "a" + char(10) + "rm -rf x" } });
  bad.typeCommand("ssh {host}");
  bad.button("Insert").props.onClick();
  assert.deepEqual(bad.calls.inserted, []);
  assert.equal(bad.errors().length, 1);

  // Spaces in a value are shown as they will be inserted, with a quoting warning.
  const spaced = dialogHarness({ context: { project: "my project" } });
  spaced.typeCommand("cd {project}");
  assert.equal(spaced.pre()[0].props.children, "cd my project");
  assert.ok(spaced.text(spaced.status()).includes("{project}"));
  assert.ok(spaced.text(spaced.status()).includes("Check the quoting"));
});

// Hand-written model: a character scanner that never uses the module's pattern.
const TOKENS = ["host", "seat", "project"];
function model(text, ctx) {
  let out = "";
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i);
    const escaped = TOKENS.find((t) => rest.startsWith("{{" + t + "}}"));
    if (escaped) {
      out += "{" + escaped + "}";
      i += escaped.length + 4;
      continue;
    }
    const token = TOKENS.find((t) => rest.startsWith("{" + t + "}"));
    if (token && text[i - 1] !== "$") {
      out += ctx[token];
      i += token.length + 2;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

test("snippet-vars expand: a fixed whitelist fills from the context, everything else stays, and any value or result a single-line snippet cannot hold is refused", () => {
  const { expand, snippetContext, MAX_CONTEXT_VALUE, SNIPPET_TOKENS } = vars();
  assert.deepEqual([...SNIPPET_TOKENS], ["host", "seat", "project"]);
  assert.equal(MAX_CONTEXT_VALUE, 255);
  const ctx = { host: "prod-1", seat: "dev.impl", project: "hrig" };
  const ok = (text, want, context = ctx) => {
    const r = expand(text, context);
    assert.equal(r.ok, true, text);
    assert.equal(r.text, want, text);
    assert.equal(r.changed, want !== text, text);
    return r;
  };
  // Known tokens, repeats and neighbors.
  ok("ssh {host}", "ssh prod-1");
  ok("{host}{seat}{project}", "prod-1dev.implhrig");
  ok("{seat}-{seat}-{seat}", "dev.impl-dev.impl-dev.impl");
  ok("a{project}b", "ahrigb");
  ok("echo done", "echo done");
  // Unknown, wrong-case, spaced and malformed names stay exactly as typed.
  for (const same of [
    "{foo}",
    "{Host}",
    "{HOST}",
    "{ host }",
    "{host }",
    "{host",
    "host}",
    "{}",
    "{{}}",
    "{{foo}}",
    "{hosts}",
    "{host-1}",
    "awk '{print $1}'",
    "echo ${HOME}",
    "for i in {1..3}; do echo $i; done",
    "docker inspect --format '{{.State}}' x",
  ])
    ok(same, same);
  // A name right after a dollar sign is shell syntax and stays; the escape still reaches it.
  ok("echo ${host}", "echo ${host}");
  ok("echo ${seat}${project}", "echo ${seat}${project}");
  ok("echo ${{host}}", "echo ${host}");
  ok("echo $ {host}", "echo $ prod-1");
  // Doubled braces around a known name give one literal pair, left to right.
  ok("{{host}}", "{host}");
  ok("{{host}} {host}", "{host} prod-1");
  ok("{{{host}}}", "{{host}}");
  ok("{{host}", "{prod-1");
  ok("{host}}", "prod-1}");
  ok("{{seat}}{{project}}", "{seat}{project}");
  // Surrounding spaces of a value are trimmed, a usable value is kept whole.
  ok("{host}", "prod-1", { host: "  prod-1 \t" });
  ok("{host}", "caf" + char(0xe9), { host: "caf" + char(0xe9) });
  ok("{host}", "x".repeat(255), { host: "x".repeat(255) });

  // Missing, blank, wrong type and inherited values are unavailable, with the token named.
  for (const context of [
    {},
    { host: "" },
    { host: "   " },
    { host: 5 },
    { host: null },
    { host: undefined },
    { host: ["a"] },
    Object.create({ host: "inherited" }),
    undefined,
    null,
    "host",
    [],
  ]) {
    const r = expand("ssh {host}", context);
    assert.equal(r.ok, false, JSON.stringify(context));
    assert.ok(r.error.includes("{host} is not available"), r.error);
    assert.ok(r.error.includes("Nothing was sent"));
    assert.ok(r.error.includes("{{host}}"), "says how to keep the braces");
  }
  assert.equal(expand("ssh {host}", { ...ctx, host: undefined }).ok, false);
  assert.equal(
    expand("no placeholders here", undefined).ok,
    true,
    "a snippet with no placeholder never needs a context",
  );
  assert.equal(expand("{{host}}", {}).ok, true, "an escape needs no value");
  assert.equal(expand("${host}", {}).ok, true, "shell syntax needs no value");
  assert.ok(expand("{seat}", { host: "h" }).error.includes("{seat}"));
  assert.ok(
    expand("{host} {seat}", {}).error.includes("{host}"),
    "the first missing token is named",
  );

  // A value with control or invisible characters, or over the cap, is refused, never changed or cut.
  const hidden = [
    10, 13, 9, 0, 27, 127, 0x85, 0x9f, 0x2028, 0x2029, 0x200b, 0x200d, 0x202e,
    0x2066, 0xad, 0xfeff,
  ];
  for (const code of hidden) {
    const r = expand("ssh {host}", { host: "a" + char(code) + "b" });
    assert.equal(r.ok, false, "code " + code);
    assert.ok(r.error.includes("control or invisible"), r.error);
    assert.ok(r.error.includes("{host}"));
  }
  const long = expand("{host}", { host: "x".repeat(256) });
  assert.equal(long.ok, false);
  assert.ok(long.error.includes("255"));
  // The result is checked again: too long once expanded, blank, multi-line or not text at all.
  const wide = expand("a".repeat(9990) + "{host}", { host: "h".repeat(30) });
  assert.equal(wide.ok, false);
  assert.ok(wide.error.includes("10,000"));
  assert.equal(
    expand("a".repeat(9990) + "{host}", { host: "h".repeat(10) }).ok,
    true,
  );
  assert.equal(expand("   ", ctx).ok, false);
  assert.equal(expand("", ctx).ok, false);
  assert.equal(expand("ls" + char(10) + "{host}", ctx).ok, false);
  assert.equal(expand("{host}" + char(13), ctx).ok, false);
  assert.equal(expand("ls" + char(0x202e) + "{host}", ctx).ok, false);
  for (const nope of [undefined, null, 5, {}, ["x"], true])
    assert.deepEqual(expand(nope, ctx), {
      ok: false,
      error: "Invalid snippet.",
    });

  // Values with spaces or shell characters are flagged once each, in order of first use.
  const careful = (value) =>
    expand("{host}", { host: value }).careful.length === 1;
  for (const value of [
    "my host",
    "a;b",
    "a&b",
    "a|b",
    "$x",
    "a`b",
    "a'b",
    'a"b',
    "a(b",
    "a<b",
    "a>b",
    "a\\b",
    "a*b",
    "a?b",
    "a!b",
    "a#b",
    "a{b",
    "a[b",
  ])
    assert.ok(careful(value), "flagged: " + value);
  for (const value of [
    "prod-1",
    "dev.impl@rig-a",
    "my_proj",
    "Ubuntu-22.04",
    "10.0.0.5",
    "caf" + char(0xe9),
  ])
    assert.ok(!careful(value), "plain: " + value);
  assert.deepEqual(
    expand("{project} {host} {project} {seat}", {
      host: "a b",
      seat: "ok",
      project: "c d",
    }).careful,
    ["project", "host"],
  );

  // snippetContext: host, else distro, else local; seat name; project from the last folder.
  const ssh = {
    id: "s",
    name: "Prod",
    kind: "ssh",
    host: "prod-1",
    distro: "x",
    root: "~",
  };
  const wsl = {
    id: "w",
    name: "WSL",
    kind: "wsl",
    distro: "Ubuntu",
    root: "/",
  };
  const local = { id: "l", name: "Local", kind: "local", root: "." };
  assert.equal(snippetContext(ssh, "/a", null).host, "prod-1");
  assert.equal(snippetContext(wsl, "/a", null).host, "Ubuntu");
  assert.equal(snippetContext(local, "/a", null).host, "local");
  assert.equal(snippetContext({ ...ssh, host: "  " }, "/a", null).host, "x");
  assert.equal(snippetContext({ ...local, host: 5 }, "/a", null).host, "local");
  for (const nothing of [null, undefined, 5, "x", []])
    assert.equal(snippetContext(nothing, "/a", null).host, "local");
  assert.deepEqual(Object.keys(snippetContext(local, "/a", null)).sort(), [
    "host",
    "project",
  ]);
  assert.equal(
    snippetContext(local, "/a", { name: " dev.impl " }).seat,
    "dev.impl",
  );
  for (const seat of [
    null,
    undefined,
    {},
    { name: "  " },
    { name: 5 },
    "dev",
    [],
  ])
    assert.ok(
      !("seat" in snippetContext(local, "/a", seat)),
      JSON.stringify(seat),
    );
  const project = (root) => snippetContext(local, root, null).project;
  assert.equal(project("/srv/apps/hrig"), "hrig");
  assert.equal(project("/srv/apps/hrig/"), "hrig");
  assert.equal(project("/srv//apps///hrig//"), "hrig");
  assert.equal(project("C:\\Users\\me\\proj"), "proj");
  assert.equal(project("C:\\Users\\me\\proj\\"), "proj");
  assert.equal(project("\\\\server\\share\\proj"), "proj");
  assert.equal(project("hrig"), "hrig");
  for (const none of [
    "/",
    "",
    "~",
    ".",
    "..",
    "C:\\",
    "C:",
    "/home/me/..",
    null,
    undefined,
    5,
    {},
  ])
    assert.equal(project(none), undefined, String(none));

  // A seeded walk against the scanner model: strings built from fragments that stress the pattern.
  let seed = 20261108;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const pieces = [
    "{",
    "}",
    "{{",
    "}}",
    "$",
    " ",
    "x",
    "host",
    "seat",
    "project",
    "{host}",
    "{seat}",
    "{project}",
    "{{host}}",
    "${host}",
    "${{seat}}",
    "{foo}",
    "{Host}",
    "{{{",
    "}}}",
  ];
  for (let run = 0; run < 400; run++) {
    let text = "";
    for (let n = 1 + Math.floor(next() * 12); n > 0; n--)
      text += pieces[Math.floor(next() * pieces.length)];
    const r = expand(text, ctx);
    if (!text.trim()) {
      assert.equal(r.ok, false);
      continue;
    }
    const want = model(text, ctx);
    assert.equal(r.ok, true, JSON.stringify(text));
    assert.equal(r.text, want, JSON.stringify(text));
    assert.equal(r.changed, want !== text, JSON.stringify(text));
    const frozen = Object.freeze({ ...ctx });
    assert.equal(expand(text, frozen).text, want, "a frozen context works");
  }
});

test("snippet-vars wiring: the pure module touches nothing, the dialog expands only on the way to Insert, and the app passes each terminal's own context", () => {
  const moduleSource = read("src/snippet-vars.ts");
  const code = stripComments(moduleSource);
  assert.ok(!/[^ -~\n]/.test(moduleSource), "printable ASCII only");
  assert.ok(!moduleSource.includes(char(92) + "u"), "no escape sequence");
  assert.deepEqual(
    [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]),
    ["./terminal-commands"],
    "the one import is the existing validator",
  );
  assert.equal(count(code, "import "), 1);
  for (const banned of [
    /\bwindow\b/,
    /\bdocument\b/,
    /\bReact\b/,
    /\bhrig\b/,
    /\bDate\b/,
    /\bperformance\b/,
    /setTimeout/,
    /\bfetch\b/,
    /localStorage|sessionStorage|indexedDB/,
    /\basync\b|\bawait\b/,
    /Math\.random/,
    /\bconsole\b/,
    /export default/,
    /\brequire\b/,
  ])
    assert.ok(!banned.test(code), "the module stays pure: " + banned);
  assert.deepEqual(
    [...code.matchAll(/^export (?:const|function|type|interface) (\w+)/gm)]
      .map((m) => m[1])
      .sort(),
    [
      "ExpandResult",
      "MAX_CONTEXT_VALUE",
      "SNIPPET_TOKENS",
      "SnippetContext",
      "SnippetToken",
      "expand",
      "snippetContext",
    ],
  );
  assert.equal(
    count(code, "snippetError("),
    2,
    "the existing validator is reused, none is added",
  );

  // The dialog: expanded text goes to the two existing outlets and nowhere else.
  const dialog = tight(stripComments(read("src/TerminalSnippets.tsx")));
  const dialogImports = [
    ...stripComments(read("src/TerminalSnippets.tsx")).matchAll(
      /^import .* from "([^"]+)";/gm,
    ),
  ].map((m) => m[1]);
  for (const needed of [
    "react",
    "./components",
    "./terminal-commands",
    "./snippet-vars",
  ])
    assert.ok(dialogImports.includes(needed), "imports " + needed);
  // The export and import views of the same dialog are the one later addition.
  for (const found of dialogImports)
    assert.ok(
      [
        "react",
        "./components",
        "./terminal-commands",
        "./snippet-vars",
        "./SnippetTransfer",
      ].includes(found),
      "no other import: " + found,
    );
  assert.equal(
    count(dialog, "expand(text, context)"),
    2,
    "one for the click, one for the preview",
  );
  assert.equal(count(dialog, "onInsert("), 2, "only the two existing outlets");
  assert.equal(count(dialog, "onInsert(expanded.text, false)"), 1);
  assert.equal(count(dialog, "onInsert(review,true)"), 1);
  assert.equal(count(dialog, "setReview(expanded.text)"), 1);
  assert.equal(
    count(dialog, "setReview(text)"),
    0,
    "the review never shows raw placeholders",
  );
  assert.equal(count(dialog, "onInsert(text"), 0, "raw text is never inserted");
  assert.ok(
    dialog.includes("name:label.trim(),text}"),
    "the saved snippet keeps the raw text",
  );
  assert.equal(count(dialog, "crypto.randomUUID()"), 1);
  assert.ok(
    !/sendTerminalCommand|writeTerminal|\\r|\\n|window\.|document\./.test(
      dialog,
    ),
    "the dialog never types into a terminal itself",
  );

  // The app computes the context where it builds the terminal target and hands it to the dialog.
  const app = tight(stripComments(read("src/App.tsx")));
  assert.equal(
    count(
      app,
      'import { snippetContext, type SnippetContext } from "./snippet-vars";',
    ),
    1,
  );
  assert.equal(
    count(
      app,
      "context: snippetContext(config.connection, config.root, config.seat)",
    ),
    1,
  );
  assert.equal(count(app, "context: SnippetContext}"), 1);
  assert.equal(count(app, "context={snippetTarget.context}"), 1);
  // The last gate before the terminal still re-validates what arrives.
  const panel = tight(stripComments(read("src/TerminalPanel.tsx")));
  assert.ok(panel.includes("snippetError(text)"));
  assert.ok(panel.includes("term.paste(text)"));
});

test("snippet-vars docs: TERMINALS.md lists the placeholders, the preview and the no-Enter guarantee", () => {
  const doc = read("TERMINALS.md");
  assert.ok(!doc.startsWith(char(0xfeff)), "no byte order mark");
  assert.ok(doc.endsWith("\n") && !doc.endsWith("\n\n"), "one final line feed");
  assert.ok(!doc.includes("\r"), "no carriage return");
  const lines = doc.split("\n");
  const hits = lines
    .map((line, i) => [line, i])
    .filter(([line]) => line.startsWith("Snippet placeholders"));
  assert.equal(hits.length, 1, "one paragraph");
  const [para, at] = hits[0];
  assert.ok(
    para.startsWith(
      "Snippet placeholders: a saved snippet may contain {host}, {seat} and {project}",
    ),
  );
  assert.ok(!/[^ -~]/.test(para), "printable ASCII on one line");
  assert.equal(lines[at - 1], "");
  assert.equal(lines[at + 1], "");
  const command = lines.findIndex((l) =>
    l.startsWith("Command center lists Focus, Clear, Find, Reconnect"),
  );
  const keys = lines.findIndex((l) =>
    l.startsWith("While a terminal has keyboard focus, Ctrl+Shift+K"),
  );
  assert.ok(command >= 0 && keys > command, "anchors exist");
  assert.ok(
    at > command && at < keys,
    "inside the snippet area, after the Command center paragraph",
  );
  for (const fragment of [
    "which Saved snippets fills in from the terminal you open it for when you choose Insert or Review insert and run",
    "{host} is the host name of the connection (a WSL connection uses its distro name and this computer says local)",
    "{seat} is the seat name of a seat terminal",
    "{project} is the last folder of the terminal's project path",
    "The dialog shows the exact text that will be inserted before you choose Insert",
    "the saved snippet keeps the placeholders as you typed them",
    "Any other text in braces is left alone",
    "${host}, is left alone because shells use that form",
    "double braces such as {{host}} insert a literal {host}",
    "A placeholder this terminal cannot fill, for example {seat} in a plain shell, is refused with a message and nothing is inserted",
    "a value with a line break or control characters is refused the same way",
    "Values are inserted as they are, without shell quoting",
    "the dialog warns when a value has spaces or shell characters",
    "Insert still never presses Enter",
    "Review insert and run still shows the expanded text and needs its own click",
  ])
    assert.ok(para.includes(fragment), "missing: " + fragment);
});
