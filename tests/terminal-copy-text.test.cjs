const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

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

const settings = load("src/settings.ts");
const copyText = load("src/terminal-copy-text.ts");
const { trimTrailingWhitespace, copyTextForClipboard } = copyText;

const KEY = "terminal.copyTrimTrailingWhitespace";
const root = path.join(__dirname, "..");
function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function collapse(text) {
  return text.replace(/\s+/g, " ");
}
function tight(text) {
  return collapse(text)
    .replace(/\( /g, "(")
    .replace(/(?:, )? ?\)/g, ")");
}
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
function sourceFiles() {
  return fs
    .readdirSync(path.join(root, "src"), { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => e.name);
}
function filesWith(pattern) {
  return sourceFiles()
    .filter((name) => pattern.test(stripComments(read("src/" + name))))
    .sort();
}
function count(text, pattern) {
  return (text.match(pattern) || []).length;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Hand-written expectations, never computed by the module under test.
const SELECTION = "ls -l  \n\tindent\t\n\nend   ";
const TRIMMED = "ls -l\n\tindent\n\nend";
const BUFFER = ["$ make  ", "ok\t", "  done  ", ""];
const BUFFER_TRIMMED = "$ make\nok\n  done";

// Real-component harness: bundles src/TerminalTools.tsx once and runs it outside React with fake hooks, a fake terminal and a fake window.
let toolsCode;
function mount(overrides = {}) {
  if (!toolsCode) {
    toolsCode = buildSync({
      entryPoints: [path.join(root, "src/TerminalTools.tsx")],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      external: [
        "react",
        "react/jsx-runtime",
        "lucide-react",
        "./SettingsContext",
        "./components",
        "@xterm/addon-search",
      ],
    }).outputFiles[0].text;
  }
  const states = [];
  const refs = [];
  let cursor = 0;
  const effects = [];
  let firstRender = true;
  const calls = [];
  const effective = {
    "terminal.copyOnSelect": false,
    "terminal.confirmMultilinePaste": false,
    [KEY]: false,
    ...overrides,
  };
  const view = { selection: "", lines: [] };
  const out = {
    written: [],
    exported: [],
    pasted: [],
    sets: [],
    prevented: 0,
    clipboardText: "echo  \n",
  };
  const listeners = {};
  let keyHandler;
  let selectionListener;
  const term = {
    loadAddon() {},
    attachCustomKeyEventHandler(f) {
      keyHandler = f;
    },
    hasSelection: () => view.selection !== "",
    getSelection: () => view.selection,
    onSelectionChange(f) {
      selectionListener = f;
      return { dispose() {} };
    },
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
    buffer: {
      active: {
        get length() {
          return view.lines.length;
        },
        getLine(i) {
          if (i >= view.lines.length) return undefined;
          return { isWrapped: false, translateToString: () => view.lines[i] };
        },
      },
    },
    paste(text) {
      out.pasted.push(text);
    },
    focus() {},
    clear() {},
  };
  const terminal = { current: term };
  const previous = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    raf: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      hrig: {
        platform: "linux",
        readClipboardText: async () => out.clipboardText,
        clipboardHasImage: async () => false,
        exportTerminal: async (text) => {
          out.exported.push(text);
          return { saved: true };
        },
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      clipboard: {
        writeText: async (text) => {
          out.written.push(text);
        },
      },
    },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (f) => f(),
  });
  const restoreGlobal = (name, descriptor) => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
  const restore = () => {
    restoreGlobal("window", previous.window);
    restoreGlobal("navigator", previous.navigator);
    restoreGlobal("requestAnimationFrame", previous.raf);
  };
  try {
    const mod = new Module("/tmp/terminal-copy-text-tools", module);
    mod.require = (name) => {
      if (name === "react") {
        return {
          useState: (v) => [v, (x) => states.push(x)],
          useRef: (v) => {
            const index = cursor++;
            refs[index] ??= { current: v };
            return refs[index];
          },
          useEffect: (f) => {
            if (firstRender) effects.push(f);
          },
        };
      }
      if (name === "react/jsx-runtime") {
        const record = (type, props) => {
          calls.push({ type, props });
          return null;
        };
        return { jsx: record, jsxs: record };
      }
      if (name === "./SettingsContext")
        return { useSettings: () => ({ effective }) };
      if (name === "@xterm/addon-search") {
        return {
          SearchAddon: class {
            onDidChangeResults() {
              return { dispose() {} };
            }
            dispose() {}
          },
        };
      }
      return {};
    };
    mod._compile(toolsCode, "/tmp/terminal-copy-text-tools");
    const props = { terminal, terminalId: "t", generation: 1 };
    const render = () => {
      cursor = 0;
      calls.length = 0;
      mod.exports.default(props);
    };
    render();
    firstRender = false;
    const attach = effects.find((f) =>
      f.toString().includes("attachCustomKeyEventHandler"),
    );
    assert.ok(attach, "the generation effect must be registered");
    attach();
    return {
      effective,
      out,
      view,
      states,
      listeners,
      render,
      press(init = {}) {
        keyHandler({
          type: "keydown",
          key: "C",
          ctrlKey: true,
          shiftKey: true,
          metaKey: false,
          altKey: false,
          preventDefault() {},
          ...init,
        });
      },
      control(predicate) {
        const element = calls.find((c) => predicate(c));
        assert.ok(element, "the control must be rendered");
        element.props.onClick();
      },
      settleSelection() {
        const timers = [];
        const realSet = globalThis.setTimeout;
        const realClear = globalThis.clearTimeout;
        globalThis.setTimeout = (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length;
        };
        globalThis.clearTimeout = () => {};
        try {
          selectionListener();
        } finally {
          globalThis.setTimeout = realSet;
          globalThis.clearTimeout = realClear;
        }
        return timers;
      },
      restore,
    };
  } catch (e) {
    restore();
    throw e;
  }
}
const byTitle = (title) => (c) => c.props && c.props.title === title;
const byLabel = (label) => (c) =>
  c.type === "button" && c.props && c.props.children === label;

test("terminal.copytrim tracer: the setting is off by default, a stored true resolves, and the real TerminalTools copy puts trimmed text on the clipboard once it is on, without re-attaching its handlers", async () => {
  assert.equal(settings.defaults[KEY], false);
  assert.equal(settings.resolveSettings()[KEY], false);
  const stored = JSON.parse('{"terminal.copyTrimTrailingWhitespace":true}');
  const safe = settings.safeOverrides(stored);
  assert.deepEqual(safe, { [KEY]: true });
  assert.equal(settings.resolveSettings(safe)[KEY], true);
  for (const bad of ["true", 1, null]) {
    const message = JSON.stringify(bad);
    const safeBad = settings.safeOverrides({ [KEY]: bad });
    assert.deepEqual(safeBad, {}, "a stored " + message + " must be dropped");
    assert.equal(
      settings.resolveSettings(safeBad)[KEY],
      false,
      "a stored " + message + " must resolve to false",
    );
  }

  const ctx = mount();
  try {
    ctx.view.selection = SELECTION;
    ctx.press();
    await tick();
    assert.deepEqual(ctx.out.written, [SELECTION]);
    assert.ok(ctx.states.includes("Selection copied."));
    ctx.effective[KEY] = true;
    ctx.render();
    ctx.press();
    await tick();
    assert.deepEqual(
      ctx.out.written,
      [SELECTION, TRIMMED],
      "the handler registered by the first render must read the setting through its ref at copy time",
    );
    ctx.effective[KEY] = false;
    ctx.render();
    ctx.press();
    await tick();
    assert.deepEqual(ctx.out.written, [SELECTION, TRIMMED, SELECTION]);
    ctx.effective[KEY] = true;
    ctx.render();
    ctx.view.selection = "  \t ";
    ctx.press();
    await tick();
    assert.equal(ctx.out.written.length, 4);
    assert.equal(
      ctx.out.written[3],
      "  \t ",
      "a copy of only spaces and tabs must never empty the clipboard",
    );
  } finally {
    ctx.restore();
  }
});

test("terminal.copytrim trimTrailingWhitespace removes only the spaces and tabs that end a line, matches an independent oracle on every short string, stays linear and keeps the module pure", () => {
  const nbsp = "a" + String.fromCharCode(0xa0);
  const ideographic = "a" + String.fromCharCode(0x3000);
  const formVertical =
    "a" + String.fromCharCode(0x0c) + String.fromCharCode(0x0b);
  const lineSep = String.fromCharCode(0x2028);
  const emoji = String.fromCodePoint(0x1f600);
  const table = [
    ["", ""],
    [" ", ""],
    ["\t", ""],
    [" \t \t", ""],
    ["abc", "abc"],
    ["abc  ", "abc"],
    ["abc\t", "abc"],
    ["abc \t ", "abc"],
    ["  abc", "  abc"],
    ["\tabc  ", "\tabc"],
    ["a  b", "a  b"],
    ["a  b  ", "a  b"],
    ["a\t\tb\t", "a\t\tb"],
    ["a  \nb", "a\nb"],
    ["a  \r\nb\t\r\n", "a\r\nb\r\n"],
    ["a\n", "a\n"],
    ["a  \n", "a\n"],
    ["a  \n\n", "a\n\n"],
    ["\n\n\n", "\n\n\n"],
    ["  \n  \n", "\n\n"],
    ["a\r\n\r\nb  ", "a\r\n\r\nb"],
    ["a  \rb", "a  \rb"],
    ["a  \r", "a  \r"],
    ["\r \n", "\r\n"],
    [nbsp, nbsp],
    [ideographic, ideographic],
    [formVertical, formVertical],
    ["a  " + lineSep + "b  ", "a  " + lineSep + "b"],
    ["x" + emoji + "  ", "x" + emoji],
    ["    leading and trailing    ", "    leading and trailing"],
  ];
  for (const [input, expected] of table) {
    assert.equal(
      trimTrailingWhitespace(input),
      expected,
      JSON.stringify(input),
    );
  }

  // Independent oracle: runs of spaces and tabs followed by an optional CR and an LF, or by the end of the text.
  const oracle = (text) => text.replace(/[ \t]+(?=\r?\n|$)/g, "");
  const symbols = [" ", "\t", "\r", "\n", "a"];
  let total = 0;
  let level = [""];
  for (let length = 0; length <= 6; length++) {
    for (const input of level) {
      total++;
      const result = trimTrailingWhitespace(input);
      assert.equal(result, oracle(input), JSON.stringify(input));
      assert.equal(
        count(result, /\n/g),
        count(input, /\n/g),
        JSON.stringify(input),
      );
      assert.ok(result.length <= input.length, JSON.stringify(input));
      // A CR is excluded: a space between a CR and its LF is trimmed into a new CRLF, so a second pass may trim again.
      if (!input.includes("\r")) {
        assert.equal(
          trimTrailingWhitespace(result),
          result,
          JSON.stringify(input),
        );
      }
    }
    if (length < 6) {
      const next = [];
      for (const input of level) for (const s of symbols) next.push(input + s);
      level = next;
    }
  }
  assert.equal(total, 19531);

  // Linear time on a long run of spaces (a regular expression backtracks quadratically here).
  const run = " ".repeat(100000);
  const big = run + "a" + run + "\ny" + run;
  const started = performance.now();
  const bigResult = trimTrailingWhitespace(big);
  const elapsed = performance.now() - started;
  assert.equal(bigResult, run + "a\ny");
  assert.ok(elapsed < 1000, "trimming took " + elapsed + " ms");

  for (const input of ["", "a  ", "  ", " \t", "a  \n  \n", "ls  \r\n"]) {
    assert.equal(
      copyTextForClipboard(input, false),
      input,
      JSON.stringify(input),
    );
  }
  assert.equal(copyTextForClipboard("a  \nb\t", true), "a\nb");
  assert.equal(copyTextForClipboard("", true), "");
  assert.equal(copyTextForClipboard("  \t", true), "  \t");
  assert.equal(copyTextForClipboard("  \n  ", true), "\n");
  assert.equal(copyTextForClipboard("a  ", undefined), "a  ");

  assert.deepEqual(Object.keys(copyText).sort(), [
    "copyTextForClipboard",
    "trimTrailingWhitespace",
  ]);
  const source = read("src/terminal-copy-text.ts");
  assert.ok(!/[^\x20-\x7e\n]/.test(source), "the module must stay ASCII only");
  const code = stripComments(source);
  for (const pattern of [
    /\bimport\b/,
    /\brequire\b/,
    /window/,
    /document/,
    /React/,
    /xterm/i,
    /\bTerminal\b/,
    /Date/,
    /performance/,
    /Math\.random/,
    /export default/,
  ]) {
    assert.ok(!pattern.test(code), "the module must stay pure: " + pattern);
  }
});

test("terminal.copytrim every route that copies terminal text trims it when the setting is on and copies it as selected when off, while export and paste stay untouched", async () => {
  const rawBuffer = "$ make  \nok\t\n  done  ";
  for (const on of [false, true]) {
    const mode = on ? "setting on" : "setting off";
    const ctx = mount({ "terminal.copyOnSelect": true });
    try {
      ctx.effective[KEY] = on;
      ctx.render();
      ctx.view.selection = SELECTION;
      ctx.view.lines = BUFFER;
      const want = on ? TRIMMED : SELECTION;

      ctx.press();
      await tick();
      assert.equal(ctx.out.written.length, 1, mode);
      assert.equal(ctx.out.written[0], want, mode + ": keyboard copy");

      ctx.control(byTitle("Copy terminal selection"));
      await tick();
      assert.equal(ctx.out.written.length, 2, mode);
      assert.equal(
        ctx.out.written[1],
        want,
        mode + ": Copy terminal selection button",
      );
      assert.ok(ctx.states.includes("Selection copied."), mode);

      ctx.control(byLabel("Copy output"));
      await tick();
      assert.equal(ctx.out.written.length, 3, mode);
      assert.equal(
        ctx.out.written[2],
        on ? BUFFER_TRIMMED : rawBuffer,
        mode + ": Copy output button",
      );
      assert.ok(ctx.states.includes("Output copied."), mode);

      const timers = ctx.settleSelection();
      assert.equal(timers.length, 1, mode + ": one settle timer");
      assert.equal(timers[0].ms, 250, mode);
      timers[0].fn();
      await tick();
      assert.equal(ctx.out.written.length, 4, mode);
      assert.equal(ctx.out.written[3], want, mode + ": copy on select");

      const event = {
        clipboardData: {
          setData: (type, text) => ctx.out.sets.push([type, text]),
        },
        preventDefault: () => {
          ctx.out.prevented++;
        },
      };
      ctx.listeners.copy(event);
      assert.deepEqual(
        ctx.out.sets,
        [["text/plain", want]],
        mode + ": native copy event",
      );
      assert.equal(ctx.out.prevented, 1, mode);
      ctx.view.selection = "";
      ctx.listeners.copy(event);
      assert.equal(
        ctx.out.sets.length,
        1,
        mode + ": no selection, nothing set",
      );
      assert.equal(ctx.out.prevented, 1, mode);
      ctx.view.selection = SELECTION;

      ctx.control(byTitle("Export terminal output"));
      await tick();
      assert.deepEqual(
        ctx.out.exported,
        [rawBuffer],
        mode + ": export keeps every blank",
      );

      ctx.press({ key: "V" });
      await tick();
      assert.deepEqual(
        ctx.out.pasted,
        ["echo  \n"],
        mode + ": paste is not converted",
      );
      assert.equal(
        ctx.out.written.length,
        4,
        mode + ": export and paste write nothing to the clipboard",
      );
    } finally {
      ctx.restore();
    }
  }
});

test("terminal.copytrim source tripwire: every write of terminal text to the clipboard goes through clipboardText, nothing else in the app writes there, and paste and export are not routed through it", () => {
  const tools = tight(stripComments(read("src/TerminalTools.tsx")));
  assert.deepEqual(
    filesWith(/\.writeText\(/),
    // The long-list chain's panels also copy: an error message (PanelBoundary), a rig log (RigPanels) and the read-only
    // snapshot of a needs-input seat or of a transcript (SeatPrompt, SeatTranscript). None is the terminal selection this
    // setting trims.
    ["PanelBoundary.tsx", "RigPanels.tsx", "SeatPrompt.tsx", "SeatTranscript.tsx", "SnippetTransfer.tsx", "TeamAssessment.tsx", "TerminalTools.tsx"],
    "a new file writes to the clipboard: route terminal text through copyTextForClipboard",
  );
  const assessment = tight(stripComments(read("src/TeamAssessment.tsx")));
  assert.ok(
    assessment.includes("navigator.clipboard.writeText(brief.prompt)"),
    "src/TeamAssessment.tsx copies the assessment prompt, which is not terminal text",
  );
  assert.equal(count(assessment, /\.writeText\(/g), 1);
  assert.deepEqual(filesWith(/\.setData\(/), ["TerminalTools.tsx"]);
  assert.deepEqual(filesWith(/getSelection\(\)/), ["TerminalTools.tsx"]);
  assert.deepEqual(filesWith(/\bterminalText\(/), [
    "TerminalTools.tsx",
    "terminal-output.ts",
  ]);
  assert.deepEqual(filesWith(/terminal-copy-text/), ["TerminalTools.tsx"]);
  assert.deepEqual(filesWith(/"terminal\.copyTrimTrailingWhitespace"/), [
    "TerminalTools.tsx",
    "settings.ts",
  ]);
  for (const file of [
    "terminal-copy-select.ts",
    "terminal-paste.ts",
    "terminal-keys.ts",
    "terminal-output.ts",
    "TerminalPanel.tsx",
    "SettingsPage.tsx",
  ]) {
    const code = stripComments(read("src/" + file));
    for (const word of [
      "copyTextForClipboard",
      "trimTrailingWhitespace",
      "copyTrim",
    ]) {
      assert.ok(!code.includes(word), file + " must not mention " + word);
    }
  }
  assert.equal(
    count(tools, /\.writeText\(/g),
    3,
    "each clipboard write in TerminalTools must pass its text through clipboardText",
  );
  assert.equal(count(tools, /\.writeText\(clipboardText\(/g), 3);
  assert.equal(count(tools, /\.setData\(/g), 1);
  assert.equal(
    count(
      tools,
      /\.setData\("text\/plain", clipboardText\(term\.getSelection\(\)\)\)/g,
    ),
    1,
  );
  assert.equal(count(tools, /clipboardText\(/g), 4);
  assert.equal(
    count(tools, /getSelection\(\)/g),
    4,
    "a new read of the terminal selection needs its own route through clipboardText",
  );
  assert.equal(count(tools, /copyTextForClipboard\(/g), 1);
  for (const fragment of [
    'import { copyTextForClipboard } from "./terminal-copy-text";',
    'const trimCopy = useRef(effective["terminal.copyTrimTrailingWhitespace"]); trimCopy.current = effective["terminal.copyTrimTrailingWhitespace"];',
    "const clipboardText = (text: string) => copyTextForClipboard(text, trimCopy.current);",
    "else void copySelection();",
    "onClick={choose(copySelection)}",
    "read: () => term.getSelection(),",
    "copy: (text) => navigator.clipboard.writeText(clipboardText(text)),",
    'const text = action === "selection" ? term.getSelection() : terminalText(term);',
    "await window.hrig.exportTerminal(text);",
    "if (!event.clipboardData || !term.hasSelection()) return;",
    'host?.addEventListener("copy", nativeCopy);',
    'host?.removeEventListener("copy", nativeCopy);',
  ]) {
    assert.ok(
      tools.includes(fragment),
      "TerminalTools.tsx must keep: " + fragment,
    );
  }
  assert.equal(
    count(tools, /effective\["terminal\.copyTrimTrailingWhitespace"\]/g),
    2,
    "handlers close over old renders, so only the ref may read the setting",
  );
  assert.equal(count(tools, /target\?\.paste\(text\)/g), 1);
  assert.equal(count(tools, /terminal\.current\?\.paste\(text\)/g), 1);
  assert.ok(
    !/paste\(clipboardText\(/.test(tools),
    "paste must never be converted",
  );
  assert.ok(
    !tools.includes("writeTerminal"),
    "the copy routes never send anything to the terminal process",
  );
  const walk = (dir) =>
    fs
      .readdirSync(path.join(root, dir), { withFileTypes: true })
      .flatMap((e) => {
        if (e.name === "node_modules") return [];
        if (e.isDirectory()) return walk(dir + "/" + e.name);
        return /\.(cjs|mjs|js|ts|tsx|html)$/.test(e.name)
          ? [dir + "/" + e.name]
          : [];
      });
  for (const dir of ["electron", "mobile", "public"]) {
    for (const file of walk(dir)) {
      const code = read(file);
      assert.ok(
        !/clipboard\.write|\.writeText\(|execCommand/.test(code),
        file + " must not write to the clipboard",
      );
    }
  }
});
