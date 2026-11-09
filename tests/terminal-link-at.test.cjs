const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ");
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const count = (text, pattern) =>
  typeof pattern === "string"
    ? text.split(pattern).length - 1
    : (text.match(pattern) || []).length;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const char = (code) => String.fromCharCode(code);

function bundle(entry, external = []) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external,
  }).outputFiles[0].text;
}
function load(entry) {
  const mod = new Module(path.join(root, entry), module);
  mod._compile(bundle(entry), path.join(root, entry));
  return mod.exports;
}
const linkAt = load("src/terminal-link-at.ts");
const { WebLinksAddon } = require("@xterm/addon-web-links");

// ---- the real xterm web-links addon over a fake buffer ----
// The addon is the installed one; only the terminal it reads is a fake: rows of text, and a flag for rows that continue the row above.
function fakeBuffer(rows, wrapped = []) {
  const lines = rows.map((text, i) => ({
    isWrapped: !!wrapped[i],
    length: Math.max(text.length, 1),
    translateToString: () => text.replace(/\s+$/, ""),
    getCell(col, cell) {
      cell.ch = text[col] || "";
      return cell;
    },
  }));
  return {
    registerLinkProvider(provider) {
      this.provider = provider;
      return { dispose() {} };
    },
    buffer: {
      active: {
        getLine: (i) => lines[i],
        getNullCell: () => ({
          ch: "",
          getChars() {
            return this.ch;
          },
          getWidth() {
            return 1;
          },
        }),
      },
    },
  };
}
// The links the real addon finds on row y (1-based), built with the real hover handlers.
function webLinks(ref, rows, wrapped, y) {
  const term = fakeBuffer(rows, wrapped);
  new WebLinksAddon(() => {}, linkAt.linkHover(ref, "url")).activate(term);
  let found = [];
  term.provider.provideLinks(y, (links) => {
    found = links || [];
  });
  return found;
}

// ---- the real TerminalTools component, run outside React over fakes ----
const TOOLS_EXTERNAL = [
  "react",
  "react/jsx-runtime",
  "lucide-react",
  "./SettingsContext",
  "./components",
  "@xterm/addon-search",
];
let toolsText;
const flatten = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === "object") {
    out.push(node);
    flatten(node.props && node.props.children, out);
  }
  return out;
};
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join("")
    : node && typeof node === "object"
      ? textOf(node.props && node.props.children)
      : typeof node === "string" || typeof node === "number"
        ? String(node)
        : "";

function mountTools({ links, selection = "", writeText, height = 800 } = {}) {
  toolsText ??= bundle("src/TerminalTools.tsx", TOOLS_EXTERNAL);
  const touched = { pasted: [], written: [], hrigCalls: [], focused: 0 };
  const listeners = {};
  const term = {
    loadAddon() {},
    attachCustomKeyEventHandler() {},
    hasSelection: () => selection !== "",
    getSelection: () => selection,
    onSelectionChange: () => ({ dispose() {} }),
    element: {
      parentElement: {
        addEventListener(name, f) {
          listeners[name] = f;
        },
        removeEventListener(name) {
          delete listeners[name];
        },
      },
    },
    buffer: { active: { viewportY: 0 } },
    scrollToLine() {},
    focus() {
      touched.focused++;
    },
    clear() {},
    paste(text) {
      touched.pasted.push(text);
    },
    selectAll() {},
  };
  const slots = [];
  const effectSlots = [];
  const pending = [];
  let hook = 0;
  let tree = null;
  let render = () => {};
  const react = {
    useState: (initial) => {
      const i = hook++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (next) => {
          const value = typeof next === "function" ? next(slots[i]) : next;
          if (Object.is(value, slots[i])) return;
          slots[i] = value;
          render();
        },
      ];
    },
    useRef: (initial) => {
      const i = hook++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect: (fn, deps) => {
      const i = hook++;
      const previous = effectSlots[i];
      const changed =
        !previous ||
        !deps ||
        deps.some((d, k) => !Object.is(d, previous.deps[k]));
      if (!changed) return;
      effectSlots[i] = { deps, cleanup: previous && previous.cleanup };
      pending.push(() => {
        if (effectSlots[i].cleanup) effectSlots[i].cleanup();
        const cleanup = fn();
        effectSlots[i].cleanup =
          typeof cleanup === "function" ? cleanup : undefined;
      });
    },
  };
  const effective = {
    "terminal.copyOnSelect": false,
    "terminal.confirmMultilinePaste": false,
    "terminal.copyTrimTrailingWhitespace": false,
  };
  const element = (type, props) => ({ type, props });
  const lucide = new Proxy({}, { get: (_, name) => String(name) });
  // Only the calls the menu makes on its own are allowed; any other bridge call is recorded and fails the test that made it.
  const hrig = new Proxy(
    {
      platform: "linux",
      clipboardHasImage: async () => false,
      readClipboardText: async () => "",
      exportTerminal: async () => ({ saved: false }),
    },
    {
      get(target, name) {
        if (name in target) return target[name];
        touched.hrigCalls.push(String(name));
        return () => Promise.resolve();
      },
    },
  );
  const previous = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      innerWidth: 1000,
      innerHeight: height,
      hrig,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      clipboard: {
        writeText:
          writeText ||
          (async (text) => {
            touched.written.push(text);
          }),
      },
    },
  });
  const restore = () => {
    for (const name of ["window", "navigator"]) {
      if (previous[name])
        Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
  };
  try {
    const mod = new Module(path.join(root, "src/TerminalTools.tsx"), module);
    mod.require = (name) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return { jsx: element, jsxs: element, Fragment: "fragment" };
      if (name === "lucide-react") return lucide;
      if (name === "./SettingsContext")
        return { useSettings: () => ({ effective }) };
      if (name === "./components") return { IconButton: "IconButton" };
      if (name === "@xterm/addon-search")
        return {
          SearchAddon: class {
            onDidChangeResults() {
              return { dispose() {} };
            }
            dispose() {}
          },
        };
      return {};
    };
    mod._compile(toolsText, path.join(root, "src/TerminalTools.tsx"));
    const Tools = mod.exports.default;
    const props = {
      terminal: { current: term },
      terminalId: "t-24",
      generation: 1,
      ...(links ? { links } : {}),
    };
    render = () => {
      hook = 0;
      tree = Tools(props);
      while (pending.length) pending.shift()();
    };
    render();
    const items = () =>
      flatten(tree)
        .filter((n) => n.type === "button" && n.props.role === "menuitem")
        .map((n) => ({
          label: textOf(n),
          disabled: !!n.props.disabled,
          click: n.props.onClick,
        }));
    return {
      touched,
      restore,
      items,
      labels: () => items().map((i) => i.label),
      openMenu(y = 20) {
        listeners.contextmenu({ preventDefault() {}, clientX: 10, clientY: y });
      },
      async click(label) {
        const item = items().find((i) => i.label === label);
        assert.ok(item, "menu item " + label);
        item.click();
        await tick();
      },
      separators: () =>
        flatten(tree).filter(
          (n) => n.props && n.props.className === "menu-separator",
        ).length,
      notice() {
        const el = flatten(tree).find(
          (n) => n.props && n.props.className === "terminal-tool-notice",
        );
        return el ? textOf(el.props.children[0]) : "";
      },
      menuStyle() {
        const el = flatten(tree).find(
          (n) => n.props && n.props.role === "menu",
        );
        return el && el.props.style;
      },
    };
  } catch (e) {
    restore();
    throw e;
  }
}
const newLinks = () => {
  const opened = [];
  return {
    opened,
    ref: { current: { hovered: null, open: (link) => opened.push(link) } },
  };
};
const BASE_MENU = [
  "Copy",
  "Save selection as snippet" + char(8230),
  "Create task from selection" + char(8230),
  "Paste",
  "Select all",
];

test("terminal-link-at tracer: a link the real xterm web-links addon reports under the pointer becomes Open link and Copy link in the real right-click menu, which open and copy through the existing routes, and a menu with no link is unchanged", async () => {
  const URL1 = "https://example.com/docs/a?b=1";
  const { ref, opened } = newLinks();

  // The real addon, with the real hover handlers, reports the link and trims what is not part of it.
  const [web] = webLinks(ref, ["see " + URL1 + ", and more"], [], 1);
  assert.equal(web.text, URL1, "trailing comma is not part of the link");
  web.hover({}, web.text);
  assert.deepEqual(ref.current.hovered, { kind: "url", text: URL1 });
  web.leave({}, web.text);
  assert.equal(ref.current.hovered, null, "leaving the link forgets it");
  const [paren] = webLinks(ref, ["open (https://example.com/a_b) now"], [], 1);
  assert.equal(paren.text, "https://example.com/a_b");
  const row1 = "x https://example.com/long/pa";
  const row2 = "th/file.html end";
  for (const y of [1, 2]) {
    const [wrap] = webLinks(ref, [row1, row2], [false, true], y);
    assert.equal(
      wrap.text,
      "https://example.com/long/path/file.html",
      "a wrapped link, row " + y,
    );
  }

  // No link under the pointer: the menu has no link items, and the bottom clamp is the one without them.
  const none = mountTools({ links: ref, selection: "sel" });
  try {
    none.openMenu(790);
    assert.deepEqual(none.labels(), BASE_MENU);
    assert.equal(none.separators(), 1);
    assert.equal(none.menuStyle().top, 577);
  } finally {
    none.restore();
  }
  // No link source at all (a panel that passes nothing): the same menu.
  const bare = mountTools({ selection: "sel" });
  try {
    bare.openMenu(20);
    assert.deepEqual(bare.labels(), BASE_MENU);
  } finally {
    bare.restore();
  }

  // A URL under the pointer: two extra items at the top, a separator, and room for them at the bottom edge.
  web.hover({}, web.text);
  const ctx = mountTools({ links: ref, selection: "sel" });
  try {
    ctx.openMenu(790);
    assert.deepEqual(ctx.labels(), ["Open link", "Copy link", ...BASE_MENU]);
    assert.equal(ctx.separators(), 2);
    assert.equal(ctx.menuStyle().top, 500, "800 - 223 - 77");
    assert.equal(ctx.menuStyle().left, 10);
    // The link was captured at the right-click: the pointer leaving later does not change an open menu.
    ref.current.hovered = null;
    assert.equal(ctx.labels().length, 7);
    await ctx.click("Copy link");
    assert.deepEqual(ctx.touched.written, [URL1], "the link text, once");
    assert.equal(ctx.notice(), "Link copied.");
    assert.deepEqual(ctx.labels(), [], "choosing closes the menu");
    assert.deepEqual(opened, [], "copy opens nothing");
    assert.deepEqual(ctx.touched.pasted, []);
    assert.deepEqual(ctx.touched.hrigCalls, [], "no other bridge call");
    assert.equal(ctx.touched.focused, 1, "focus goes back to the terminal");
  } finally {
    ctx.restore();
  }

  // Open link hands the same link to the opener the panel installed; it copies nothing and types nothing.
  web.hover({}, web.text);
  const open = mountTools({ links: ref });
  try {
    open.openMenu(20);
    assert.equal(open.menuStyle().top, 20);
    await open.click("Open link");
    assert.deepEqual(opened, [{ kind: "url", text: URL1 }]);
    assert.deepEqual(open.touched.written, []);
    assert.deepEqual(open.touched.pasted, []);
    assert.deepEqual(open.touched.hrigCalls, []);
    assert.deepEqual(open.labels(), []);
    assert.equal(open.touched.focused, 1, "focus goes back to the terminal");
  } finally {
    open.restore();
  }

  // A file path: Open carries the line, Copy puts the path alone on the clipboard.
  const path1 = linkAt.linkHover(ref, "path", 12);
  path1.hover({}, "src/App.tsx");
  assert.deepEqual(ref.current.hovered, {
    kind: "path",
    text: "src/App.tsx",
    line: 12,
  });
  const file = mountTools({ links: ref });
  try {
    file.openMenu(20);
    assert.deepEqual(file.labels().slice(0, 2), ["Open link", "Copy link"]);
    await file.click("Open link");
    assert.deepEqual(opened[1], {
      kind: "path",
      text: "src/App.tsx",
      line: 12,
    });
    file.openMenu(20);
    await file.click("Copy link");
    assert.deepEqual(file.touched.written, ["src/App.tsx"]);
  } finally {
    file.restore();
  }
  path1.leave();
  const gone = mountTools({ links: ref });
  try {
    gone.openMenu(20);
    assert.deepEqual(gone.labels(), BASE_MENU);
  } finally {
    gone.restore();
  }

  // A clipboard that refuses uses the existing notice line and does not open anything.
  web.hover({}, web.text);
  const failing = mountTools({
    links: ref,
    writeText: async () => {
      throw new Error("Clipboard is blocked.");
    },
  });
  try {
    failing.openMenu(20);
    await failing.click("Copy link");
    assert.equal(failing.notice(), "Clipboard is blocked.");
    assert.equal(opened.length, 2);
  } finally {
    failing.restore();
  }

  // An opener that is gone (the terminal is not attached) is a quiet no-op.
  ref.current.open = null;
  web.hover({}, web.text);
  const detached = mountTools({ links: ref });
  try {
    detached.openMenu(20);
    await detached.click("Open link");
    assert.equal(opened.length, 2);
    assert.equal(detached.notice(), "");
  } finally {
    detached.restore();
  }
});

test("terminal-link-at module: hoveredLink keeps only safe text, isPrimaryActivation lets only a primary click open a link, and linkHover records and forgets", () => {
  const { hoveredLink, isPrimaryActivation, linkHover, MAX_LINK_TEXT } = linkAt;
  assert.equal(MAX_LINK_TEXT, 4096);

  // hoveredLink: the table.
  assert.deepEqual(hoveredLink("url", "https://a.b/c"), {
    kind: "url",
    text: "https://a.b/c",
  });
  assert.deepEqual(hoveredLink("url", "https://a.b/c", 5), {
    kind: "url",
    text: "https://a.b/c",
  });
  assert.deepEqual(hoveredLink("path", "src/a.ts"), {
    kind: "path",
    text: "src/a.ts",
  });
  assert.deepEqual(hoveredLink("path", "src/a.ts", 1), {
    kind: "path",
    text: "src/a.ts",
    line: 1,
  });
  assert.deepEqual(hoveredLink("path", "C:\\a b\\c.ts", 40), {
    kind: "path",
    text: "C:\\a b\\c.ts",
    line: 40,
  });
  for (const line of [0, -1, 1.5, NaN, Infinity, 2 ** 53, "3", null, {}])
    assert.equal(hoveredLink("path", "a.ts", line), null, String(line));
  for (const kind of ["URL", "file", "", undefined, null, 1])
    assert.equal(hoveredLink(kind, "a.ts"), null, String(kind));
  for (const text of ["", undefined, null, 5, {}, ["a"]])
    assert.equal(hoveredLink("path", text), null, String(text));
  assert.notEqual(hoveredLink("url", "h".repeat(MAX_LINK_TEXT)), null);
  assert.equal(hoveredLink("url", "h".repeat(MAX_LINK_TEXT + 1)), null);
  // Controls, DEL, C1 and the two separators refuse; the neighbors stay.
  for (const code of [0, 9, 10, 13, 27, 31, 127, 128, 159, 8232, 8233])
    assert.equal(
      hoveredLink("url", "a" + char(code) + "b"),
      null,
      String(code),
    );
  for (const code of [32, 126, 160, 8231, 8234])
    assert.notEqual(
      hoveredLink("url", "a" + char(code) + "b"),
      null,
      String(code),
    );
  // A well-formed pair and a space-bearing path are fine.
  assert.notEqual(
    hoveredLink("path", "a/" + String.fromCodePoint(0x1f600) + ".txt"),
    null,
  );

  // A seeded walk against an independent model of the rules.
  let seed = 20261108;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const pieces = [
    "a",
    "Z",
    "9",
    "/",
    ".",
    ":",
    "-",
    "_",
    "~",
    " ",
    "?",
    "#",
    char(233),
    String.fromCodePoint(0x1f600),
    char(8203),
    char(160),
    char(0),
    char(10),
    char(27),
    char(127),
    char(141),
    char(8232),
    char(8233),
  ];
  const model = (text) =>
    text.length > 0 &&
    text.length <= 4096 &&
    ![...text].some((c) => {
      const code = c.codePointAt(0);
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        code === 8232 ||
        code === 8233
      );
    });
  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < 3000; i++) {
    let text = "";
    const length = Math.floor(next() * 12);
    for (let k = 0; k < length; k++)
      text += pieces[Math.floor(next() * pieces.length)];
    const kind = next() < 0.5 ? "url" : "path";
    const got = hoveredLink(kind, text);
    assert.equal(got !== null, model(text), JSON.stringify(text));
    if (got) {
      assert.deepEqual(got, { kind, text });
      accepted++;
    } else refused++;
  }
  assert.ok(
    accepted > 500 && refused > 500,
    accepted + " accepted, " + refused + " refused",
  );

  // isPrimaryActivation.
  const click = (button, ctrlKey = false) => ({ button, ctrlKey });
  for (const platform of ["linux", "win32", "darwin", undefined, "freebsd"])
    assert.equal(
      isPrimaryActivation(click(0), platform),
      true,
      String(platform),
    );
  for (const button of [1, 2, 3, 4, -1, undefined, null, "0", false])
    assert.equal(
      isPrimaryActivation({ button }, "linux"),
      false,
      String(button),
    );
  assert.equal(
    isPrimaryActivation(click(0, true), "linux"),
    true,
    "Ctrl-click opens on Linux",
  );
  assert.equal(
    isPrimaryActivation(click(0, true), "win32"),
    true,
    "and on Windows",
  );
  assert.equal(
    isPrimaryActivation(click(0, true), "darwin"),
    false,
    "Control-click is a right-click on macOS",
  );
  assert.equal(isPrimaryActivation(click(0, false), "darwin"), true);
  assert.equal(isPrimaryActivation(click(2, true), "darwin"), false);
  assert.equal(isPrimaryActivation({}, "linux"), false);

  // linkHover: hover records through hoveredLink, leave forgets, a bad text forgets too, nothing else is touched.
  const ref = { current: { hovered: null, open: null } };
  const url = linkHover(ref, "url");
  url.hover({}, "https://a.b/c");
  assert.deepEqual(ref.current.hovered, { kind: "url", text: "https://a.b/c" });
  url.hover({}, "https://a.b/" + char(10));
  assert.equal(ref.current.hovered, null, "unsafe text leaves no stale link");
  url.hover({}, "https://a.b/c");
  url.leave();
  assert.equal(ref.current.hovered, null);
  const file = linkHover(ref, "path", 7);
  file.hover({}, "a/b.ts");
  assert.deepEqual(ref.current.hovered, {
    kind: "path",
    text: "a/b.ts",
    line: 7,
  });
  assert.equal(ref.current.open, null, "open is never touched");
  const noLine = linkHover(ref, "path");
  noLine.hover({}, "a/b.ts");
  assert.deepEqual(ref.current.hovered, { kind: "path", text: "a/b.ts" });
  assert.deepEqual(Object.keys(url).sort(), ["hover", "leave"]);
});

test("terminal-link-at wiring: one pure module, one open path, only a primary click opens, the clipboard route and the menu clamp are the existing ones, and nothing is sent to the terminal or main", () => {
  const mod = read("src/terminal-link-at.ts");
  const code = stripComments(mod);
  assert.ok(!/[^ -~\n]/.test(mod), "the module is printable ASCII");
  assert.ok(!mod.includes("\\" + "u"), "no unicode escape");
  assert.ok(
    !/\b(import|require|window|document|React|hrig|Date|performance|setTimeout|fetch|localStorage|sessionStorage|indexedDB|async|await|writeTerminal|clipboard|paste|openTerminalLink|export default)\b|Math\.random/.test(
      code,
    ),
    "the module is pure",
  );
  assert.deepEqual(
    [...code.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(
      (m) => m[1],
    ),
    [
      "MAX_LINK_TEXT",
      "LinkKind",
      "TerminalLink",
      "TerminalLinks",
      "hoveredLink",
      "isPrimaryActivation",
      "linkHover",
    ],
  );

  // The panel: the one open path, the click guard, the hover handlers, the opener.
  const panel = collapse(stripComments(read("src/TerminalPanel.tsx")));
  assert.equal(count(panel, "openTerminalLink("), 1, "one URL open path");
  assert.equal(count(panel, "window.hrig .edit("), 1, "one path open route");
  assert.equal(count(panel, "terminalPathLinks("), 1);
  assert.equal(count(panel, "new WebLinksAddon("), 1);
  assert.equal(
    count(panel, "isPrimaryActivation(event, window.hrig.platform)"),
    2,
  );
  for (const fragment of [
    'import { isPrimaryActivation, linkHover, type TerminalLinks, } from "./terminal-link-at";',
    "const linkRef = useRef<TerminalLinks>({ hovered: null, open: null });",
    "const openUrl = (uri: string) => { window.hrig.openTerminalLink(uri).catch((e) => setError(e.message)); };",
    "const openPath = (file: string, line?: number) => {",
    'linkRef.current.open = (link) => link.kind === "url" ? openUrl(link.text) : openPath(link.text, link.line);',
    'if (isPrimaryActivation(event, window.hrig.platform)) openUrl(uri); }, linkHover(linkRef, "url")),',
    'activate: (event: MouseEvent) => { if (isPrimaryActivation(event, window.hrig.platform)) openPath(file, line); }, ...linkHover(linkRef, "path", line),',
    "linkRef.current.hovered = null; linkRef.current.open = null; clearTimeout(stableTimer);",
    "links={linkRef}",
  ])
    assert.ok(
      panel.includes(fragment),
      "TerminalPanel.tsx must keep: " + fragment,
    );
  assert.equal(count(panel, "links={linkRef}"), 1);
  assert.ok(
    !/clipboard|writeText/.test(panel),
    "the panel never touches the clipboard",
  );
  assert.equal(
    count(panel, "writeTerminal("),
    2,
    "the two existing terminal writes, none added",
  );

  // The menu: the existing clipboard route, the items, the clamp.
  const toolsRaw = read("src/TerminalTools.tsx");
  const tools = collapse(stripComments(toolsRaw));
  assert.equal(count(tools, ".writeText("), 3, "no new clipboard write");
  assert.equal(count(tools, ".writeText(clipboardText("), 3);
  assert.equal(count(tools, /copyText\(/g), 2);
  assert.equal(
    count(
      tools,
      "const copyText = async (text: string, done: string) => { try { await navigator.clipboard.writeText(clipboardText(text)); setNotice(done); }",
    ),
    1,
  );
  assert.equal(count(tools, "target?.paste(text)"), 1);
  assert.equal(count(tools, "terminal.current?.paste(text)"), 1);
  assert.ok(
    !/writeTerminal|sendTerminalCommand|openTerminalLink|\.edit\(/.test(tools),
    "the menu never writes to the terminal and has no second open path",
  );
  assert.equal(count(tools, "links?.current.hovered"), 1);
  assert.equal(count(tools, "links?.current.open?.("), 1);
  assert.equal(
    count(
      tools,
      'import type { TerminalLink, TerminalLinks } from "./terminal-link-at";',
    ),
    1,
  );
  assert.equal(count(tools, "<span>Open link</span>"), 1);
  assert.equal(count(tools, "<span>Copy link</span>"), 1);
  assert.equal(count(tools, 'copyText(menuLink.text, "Link copied.")'), 1);
  assert.equal(
    count(
      tools,
      "window.innerHeight - 223 - (menuLink ? LINK_ITEMS_HEIGHT : 0)",
    ),
    1,
  );
  assert.equal(count(tools, "const LINK_ITEMS_HEIGHT = 77;"), 1);
  assert.equal(count(tools, "window.innerWidth - 180"), 1);

  // The clamp covers the tallest menu, computed from the real CSS numbers and the real item and separator counts.
  const css = read("src/styles.css");
  const rule = (selector) => {
    const at = css.indexOf("\n" + selector + " {");
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf("}", at));
  };
  const px = (block, property) => {
    const m = block.match(new RegExp("\\n\\s*" + property + ": (\\d+)px"));
    assert.ok(m, property);
    return Number(m[1]);
  };
  const menuTop = tools.indexOf('role="menu"');
  const menuBlock = tools.slice(
    menuTop,
    tools.indexOf("{pasteAsk &&", menuTop),
  );
  const items = count(menuBlock, 'role="menuitem"');
  const separators = count(menuBlock, 'className="menu-separator"');
  const item = px(rule(".dropdown > button"), "min-height");
  const sep =
    px(rule(".dropdown .menu-separator"), "height") +
    2 * px(rule(".dropdown .menu-separator"), "margin");
  const frame =
    2 * px(rule(".dropdown"), "padding") + 2 * px(rule(".dropdown"), "border");
  assert.equal(
    items,
    9,
    "Open link, Copy link, Copy, Save, Create task, Paste, Paste from history, Paste image, Select all",
  );
  assert.equal(separators, 2);
  assert.equal(
    frame + item * 6 + sep,
    223,
    "the clamp is the tallest menu without link items",
  );
  assert.equal(
    frame + item * items + sep * separators,
    223 + 77 + 33,
    "the clamp with link items and the paste history item is the tallest menu",
  );

  // The installed xterm and addon say what the plan relies on.
  const addonPkg = JSON.parse(
    read("node_modules/@xterm/addon-web-links/package.json"),
  );
  assert.equal(addonPkg.version, "0.12.0");
  const typings = read(
    "node_modules/@xterm/addon-web-links/typings/addon-web-links.d.ts",
  );
  assert.ok(
    /hover\?\(event: MouseEvent, text: string, location: IViewportRange\): void;/.test(
      typings,
    ),
  );
  assert.ok(/leave\?\(event: MouseEvent, text: string\): void;/.test(typings));
  const linkifier = read("node_modules/@xterm/xterm/src/browser/Linkifier.ts");
  const up = linkifier.slice(
    linkifier.indexOf("private _handleMouseUp("),
    linkifier.indexOf("private _clearCurrentLink("),
  );
  assert.ok(
    up.includes(
      "this._currentLink.link.activate(event, this._currentLink.link.text);",
    ),
  );
  assert.ok(
    !/button/.test(up),
    "xterm activates a link on any button release, so the panel guards the click itself",
  );
  assert.ok(linkifier.includes("link.hover(event, link.text);"));
  assert.ok(linkifier.includes("link.leave(event, link.text);"));

  // Nothing else moved: no setting, no shortcut, no main-process or preload change for links.
  for (const file of [
    "src/settings.ts",
    "src/shortcuts.ts",
    "src/SettingsPage.tsx",
    "src/types.ts",
  ])
    assert.ok(!/terminal-link|linkHover|hoveredLink/.test(read(file)), file);
  for (const file of fs
    .readdirSync(path.join(root, "electron"))
    .filter((f) => /\.(cjs|mjs)$/.test(f)))
    assert.ok(
      !/terminal-link|hoveredLink|isPrimaryActivation/.test(
        read("electron/" + file),
      ),
      file,
    );
});

test("terminal-link-at docs: TERMINALS.md says when the link items appear, what each does and that only a left click opens a link, and its words match the menu and the open path", () => {
  const doc = read("TERMINALS.md");
  assert.ok(!doc.startsWith(char(65279)), "no byte order mark");
  assert.ok(doc.endsWith("\n") && !doc.endsWith("\n\n"), "one final line feed");
  assert.ok(!doc.includes("\r"), "no carriage return");
  const lines = doc.split("\n");
  const at = lines.findIndex((l) => l.startsWith("Right-click a link"));
  assert.ok(at > 0, "the paragraph exists");
  assert.equal(
    lines.filter((l) => l.startsWith("Right-click a link")).length,
    1,
    "exactly one such paragraph",
  );
  const para = lines[at];
  assert.ok(
    para.startsWith(
      "Right-click a link in a terminal to get Open link and Copy link at the top of the right-click menu.",
    ),
  );
  assert.ok(
    !/[^ -~]/.test(para),
    "the paragraph is printable ASCII on one line",
  );
  assert.equal(lines[at - 1], "", "a blank line before");
  assert.equal(lines[at + 1], "", "a blank line after");
  assert.ok(
    lines[at - 2].startsWith("HTTP/HTTPS links require native confirmation"),
    "right after the links paragraph",
  );
  assert.ok(
    lines[at + 2].startsWith("These controls do not recreate the PTY"),
    "right before the controls paragraph",
  );
  for (const fragment of [
    "The items appear only while the pointer is on a link that HRig already underlines when you point at it",
    "a web address (http or https) or a file path with an extension",
    "including one that wraps onto the next row",
    "a right-click anywhere else shows the same menu as before",
    "Open link does exactly what clicking the link does",
    'a web address asks "Open this link in your browser?" first',
    "a link with a user name or password or a protocol other than http or https is refused",
    "a file path opens in an HRig editor tab at its line after the same check as a click",
    "Copy link puts the web address, or the path without its line number, on the clipboard",
    'shows "Link copied."',
    "a clipboard error uses the same notice line as Copy",
    "Nothing is typed into the terminal or sent to the shell or the seat.",
    "Only a left click opens a link",
    "a right-click or middle-click on a link does not",
    "neither does a Control-click on macOS, where it opens the menu",
    "a quoted path with no separator before its first space, gets no items",
  ])
    assert.ok(para.includes(fragment), "TERMINALS.md must say: " + fragment);

  // The words are the ones the product uses.
  const tools = collapse(stripComments(read("src/TerminalTools.tsx")));
  assert.ok(tools.includes("<span>Open link</span>"));
  assert.ok(tools.includes("<span>Copy link</span>"));
  assert.ok(tools.includes('"Link copied."'));
  const main = read("electron/terminal-tools.cjs");
  assert.ok(main.includes('message: "Open this link in your browser?"'));
  assert.ok(main.includes('["http:", "https:"].includes(url.protocol)'));
  assert.ok(collapse(main).includes("url.username || url.password"));
  // No setting row for this.
  assert.ok(
    !/link/i.test(
      read("SETTINGS.md")
        .split("\n")
        .filter((l) => /terminal\.(link|openLink|copyLink)/.test(l))
        .join("\n"),
    ),
  );
  assert.equal(count(doc, "Right-click a link"), 1);
});
