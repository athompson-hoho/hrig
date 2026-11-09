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

const bell = load("src/terminal-bell.ts");
const settings = load("src/settings.ts");
const activity = load("src/terminal-activity.ts");
const {
  shouldFlash,
  bellSettled,
  BELL_FLASH_MS,
  BELL_COOLDOWN_MS,
  BELL_SETTLE_MS,
} = bell;

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
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `the stylesheet must have a ${selector} rule`);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("terminal.bell tracer: the default stays silent, a stored visual override resolves, one bell flashes, and the overlay is mounted inside the terminal stage", () => {
  assert.equal(settings.defaults["terminal.bellStyle"], "none");
  assert.equal(settings.resolveSettings()["terminal.bellStyle"], "none");
  const stored = JSON.parse('{"terminal.bellStyle":"visual"}');
  const resolved = settings.resolveSettings(settings.safeOverrides(stored));
  assert.equal(resolved["terminal.bellStyle"], "visual");
  const corrupt = JSON.parse('{"terminal.bellStyle":"sound"}');
  assert.deepEqual(settings.safeOverrides(corrupt), {});
  assert.equal(
    settings.resolveSettings(settings.safeOverrides(corrupt))[
      "terminal.bellStyle"
    ],
    "none",
  );
  const style = resolved["terminal.bellStyle"];
  assert.equal(
    shouldFlash(
      settings.defaults["terminal.bellStyle"],
      10000,
      -Infinity,
      BELL_COOLDOWN_MS,
    ),
    false,
  );
  assert.equal(shouldFlash(style, 10000, -Infinity, BELL_COOLDOWN_MS), true);
  assert.equal(shouldFlash(style, 10001, 10000, BELL_COOLDOWN_MS), false);

  const panel = collapse(read("src/TerminalPanel.tsx"));
  const stageStart = panel.indexOf('<div className="terminal-stage">');
  assert.ok(stageStart >= 0, "TerminalPanel must have a terminal stage");
  const stage = panel.slice(
    stageStart,
    panel.indexOf("</div>", stageStart) + "</div>".length,
  );
  assert.ok(
    stage.includes(
      "<TerminalBell terminal={terminalRef} generation={attempt * 2 + (ready ? 1 : 0)} />",
    ),
    "the visual bell overlay must be mounted inside the terminal stage with the same terminal and generation as its siblings",
  );

  const source = tight(read("src/TerminalBell.tsx"));
  const pins = [
    [
      'useSettings().effective["terminal.bellStyle"]',
      "the overlay must follow the effective bell style preference",
    ],
    ["term.onBell(", "the overlay must listen to the bell event"],
    [
      "if (!bellSettled(now, attachedAt)) return;",
      "bells replayed from history right after attach must not flash",
    ],
    [
      "shouldFlash(styleRef.current, now, lastFlash, BELL_COOLDOWN_MS)",
      "every bell must go through the pure shouldFlash decision",
    ],
    [
      "timer = setTimeout(() => setFlashing(false), BELL_FLASH_MS);",
      "the flash must end after BELL_FLASH_MS",
    ],
    [
      "return () => { subscription.dispose(); clearTimeout(timer); };",
      "the effect cleanup must dispose the subscription and the timer",
    ],
    [
      "}, [generation]);",
      "the subscription must follow the terminal instance, not the setting",
    ],
    [
      'if (style !== "visual" || !flashing) return null;',
      "the overlay must render nothing unless the style is visual and a flash is running",
    ],
    [
      '<div className="terminal-bell-flash" aria-hidden="true" />',
      "the overlay element must be hidden from screen readers",
    ],
  ];
  for (const [statement, message] of pins) {
    assert.ok(source.includes(statement), message);
  }
  const css = read("src/styles.css");
  assert.match(ruleBody(css, ".terminal-bell-flash"), /position:\s*absolute/);
});

test("terminal.bell shouldFlash only flashes the visual style and rate-limits with an injected clock", () => {
  const C = BELL_COOLDOWN_MS;
  for (const style of [
    "none",
    "",
    "Visual",
    "VISUAL",
    "visual ",
    " visual",
    "visual;",
    "notification",
    "sound",
    "audible",
  ]) {
    assert.equal(
      shouldFlash(style, 5000, -Infinity, C),
      false,
      `style ${JSON.stringify(style)} must never flash`,
    );
  }
  assert.equal(shouldFlash("visual", 5000, -Infinity, C), true);
  assert.equal(shouldFlash("visual", 5000, NaN, C), true);
  assert.equal(shouldFlash("visual", 0, -Infinity, C), true);
  assert.equal(shouldFlash("visual", 0, NaN, C), true);

  const last = 20000;
  assert.equal(shouldFlash("visual", last + C - 1, last, C), false);
  assert.equal(shouldFlash("visual", last + C, last, C), true);
  assert.equal(shouldFlash("visual", last, last, C), false);

  assert.equal(shouldFlash("visual", 99, 0, 100), false);
  assert.equal(shouldFlash("visual", 100, 0, 100), true);
  assert.equal(shouldFlash("visual", 7, 7, 0), true);
  assert.equal(shouldFlash("visual", 7, 7, -50), true);
  assert.equal(shouldFlash("visual", last + C - 1, last, NaN), false);
  assert.equal(shouldFlash("visual", last + C, last, NaN), true);

  assert.equal(shouldFlash("visual", 100, 5000, C), true);

  for (const now of [NaN, Infinity, -Infinity]) {
    assert.equal(shouldFlash("visual", now, -Infinity, C), false);
    assert.equal(shouldFlash("visual", now, 0, C), false);
  }

  function storm(style) {
    const flashes = [];
    let lastFlash = -Infinity;
    for (let now = 0; now < 5000; now += 50) {
      if (shouldFlash(style, now, lastFlash, C)) {
        flashes.push(now);
        lastFlash = now;
      }
    }
    return flashes;
  }
  const flashes = storm("visual");
  assert.equal(flashes[0], 0);
  assert.equal(flashes.length, Math.ceil(5000 / C));
  for (let i = 1; i < flashes.length; i++) {
    assert.ok(
      flashes[i] - flashes[i - 1] >= C,
      "flashes must be a cooldown apart",
    );
  }
  assert.equal(storm("none").length, 0);
});

test("terminal.bell constants keep the flash under 200 ms and under three flashes a second, and the settle window matches the alert tracker", () => {
  assert.ok(BELL_FLASH_MS > 0 && BELL_FLASH_MS <= 200);
  assert.ok(BELL_COOLDOWN_MS >= BELL_FLASH_MS);
  assert.ok(1000 / BELL_COOLDOWN_MS <= 3);
  assert.equal(BELL_SETTLE_MS, activity.defaultActivity.settleMs);
  assert.equal(bellSettled(BELL_SETTLE_MS - 1, 0), false);
  assert.equal(bellSettled(BELL_SETTLE_MS, 0), true);
  assert.equal(bellSettled(5000, 2001, 3000), false);
  assert.equal(bellSettled(5001, 2001, 3000), true);
  assert.equal(bellSettled(42, 42, 0), true);
  for (const now of [NaN, Infinity, -Infinity]) {
    assert.equal(bellSettled(now, 0), false);
  }
});

test("terminal.bell flash overlay CSS floats over the stage, takes no clicks, matches the timer, and survives reduced motion", () => {
  const css = read("src/styles.css");
  const body = ruleBody(css, ".terminal-bell-flash");
  assert.match(body, /position:\s*absolute/);
  assert.match(body, /inset:\s*0\b/);
  assert.match(body, /pointer-events:\s*none/);
  assert.match(body, /box-shadow:/);
  for (const property of [
    "margin",
    "padding",
    "width",
    "height",
    "float",
    "display",
    "transition",
  ]) {
    assert.doesNotMatch(
      body,
      new RegExp(`(^|[^-\\w])${property}\\s*:`),
      `the overlay must not set ${property}, so it cannot move or resize anything`,
    );
  }
  assert.doesNotMatch(
    body,
    /opacity:\s*0(?![.\d])/,
    "the overlay must stay visible without its animation",
  );
  assert.doesNotMatch(
    body,
    /visibility\s*:/,
    "the overlay must stay visible without its animation",
  );
  const animation = /animation:\s*terminal-bell-flash\s+([\d.]+)(ms|s)\b/.exec(
    body,
  );
  assert.ok(
    animation,
    "the overlay must use the terminal-bell-flash animation",
  );
  const durationMs = Number(animation[1]) * (animation[2] === "s" ? 1000 : 1);
  assert.equal(
    Math.round(durationMs),
    BELL_FLASH_MS,
    "the CSS fade must last as long as the timer that unmounts the overlay",
  );
  assert.match(css, /@keyframes terminal-bell-flash\s*\{/);
  assert.match(
    css,
    /:root\[data-reduced-motion="true"\] \*[^{]*\{[^}]*animation:\s*none\s*!important/,
    "the Reduce motion setting must remove the fade",
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*\s*\{[^}]*animation:\s*none\s*!important/,
    "the operating-system reduced motion preference must remove the fade",
  );
});

test("terminal.bell stays independent of the desktop notification path, writes nothing to the terminal, plays no sound, and mounts once", () => {
  const visualOnly = settings.resolveSettings({
    "terminal.bellStyle": "visual",
  });
  assert.equal(visualOnly["notifications.terminalBell"], false);
  assert.equal(visualOnly["notifications.desktop"], false);
  const notifyOnly = settings.resolveSettings({
    "notifications.terminalBell": true,
    "notifications.desktop": true,
  });
  assert.equal(notifyOnly["terminal.bellStyle"], "none");

  const alerts = tight(read("src/TerminalAlerts.tsx"));
  assert.ok(
    alerts.includes(
      'term.onBell(() => { if (bell && !watching() && tracker.bell(Date.now())) send("bell"); })',
    ),
    "the desktop notification for a bell must keep working exactly as before",
  );
  assert.ok(!alerts.includes("bellStyle"));

  const panel = collapse(read("src/TerminalPanel.tsx"));
  assert.ok(
    panel.includes(
      'bell={ preferences["notifications.desktop"] && preferences["notifications.terminalBell"] }',
    ),
    "TerminalAlerts must stay gated by the notification settings only",
  );
  assert.equal(panel.split("<TerminalAlerts").length - 1, 1);
  assert.equal(panel.split("<TerminalBell").length - 1, 1);

  for (const file of ["src/TerminalBell.tsx", "src/terminal-bell.ts"]) {
    const code = stripComments(read(file));
    for (const token of [
      "writeTerminal",
      "resizeTerminal",
      "window.hrig",
      "notifyAttention",
      "notifications.",
      ".write(",
      ".paste(",
      ".input(",
      "Audio",
      "beep",
      ".play(",
      "speechSynthesis",
    ]) {
      assert.ok(
        !code.includes(token),
        `${file} is display only and must not contain ${token}`,
      );
    }
  }
  const imports = [
    ...read("src/terminal-bell.ts").matchAll(/from\s+"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(imports, ["./terminal-activity"]);

  const srcDir = path.join(root, "src");
  const mounting = fs
    .readdirSync(srcDir)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => read(`src/${name}`).includes("<TerminalBell"));
  assert.deepEqual(mounting, ["TerminalPanel.tsx"]);
});
