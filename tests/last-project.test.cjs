"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync, transformSync } = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const count = (text, part) => text.split(part).length - 1;
const isAscii = (text) => !/[^\n -~]/.test(text);
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function load(entry) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod.require = (id) => require(id);
  mod._compile(built.outputFiles[0].text, mod.filename);
  return mod.exports;
}
const ph = load("src/project-history.ts");
const lib = load("src/last-project.ts");
const { pickLastProject, planLastProject } = lib;

const local = { id: "local", name: "This computer", kind: "local", root: "~" };
const wsl = {
  id: "wsl-ubuntu",
  name: "Ubuntu",
  kind: "wsl",
  distro: "Ubuntu",
  root: "~",
};
const sshA = {
  id: "ssh-a",
  name: "Alpha",
  kind: "ssh",
  host: "alpha.example",
  port: 22,
  root: "~",
};
const sshB = {
  id: "ssh-b",
  name: "Beta",
  kind: "ssh",
  host: "beta.example",
  port: 2222,
  root: "~",
};
const ALL = [local, wsl, sshA, sshB];
const OS = "linux";

// A history entry as the app saves it, with the real identity functions.
function entry(connection, folder, lastOpened, extra = {}, os = OS) {
  const name = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
  return {
    id: ph.projectIdentity(connection, folder, os),
    connectionId: connection.id,
    endpoint: ph.connectionIdentity(connection, os),
    hostName: connection.name,
    root: folder,
    name,
    lastOpened,
    pinned: false,
    rigId: "",
    rigName: "",
    ...extra,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The real restore block of App.tsx, compiled and run over a tiny react: slot-based refs and effects that run after a render when their dependencies changed.
function restoreBlock() {
  const app = read("src/App.tsx");
  const start = "  const restoreChecked = useRef(false);\n";
  const end = "  }, [loaded]);\n";
  const from = app.indexOf(start);
  const to = app.indexOf(end, from);
  assert.ok(from > 0 && to > from, "the restore block is in App.tsx");
  assert.equal(app.indexOf(start, from + 1), -1, "the block is there once");
  return app.slice(from, to + end.length);
}
function mountRestore({ openRecentProject, log }) {
  const code = transformSync(restoreBlock(), { loader: "ts" }).code;
  const make = new Function(
    "useRef",
    "useEffect",
    "planLastProject",
    "userPreferences",
    "projectHistory",
    "state",
    "window",
    "connection",
    "root",
    "openRecentProject",
    "log",
    "loaded",
    code,
  );
  const store = { refs: [], deps: [] };
  return (props) => {
    let refSlot = 0;
    let effectSlot = 0;
    const queue = [];
    const useRef = (initial) => {
      const at = refSlot++;
      if (!store.refs[at]) store.refs[at] = { current: initial };
      return store.refs[at];
    };
    const useEffect = (fn, deps) => {
      const at = effectSlot++;
      const old = store.deps[at];
      if (
        !old ||
        old.length !== deps.length ||
        deps.some((dep, i) => !Object.is(dep, old[i]))
      ) {
        store.deps[at] = deps;
        queue.push(fn);
      }
    };
    make(
      useRef,
      useEffect,
      planLastProject,
      props.userPreferences,
      props.projectHistory,
      props.state,
      { hrig: { platform: props.platform ?? OS } },
      props.connection,
      props.root,
      openRecentProject,
      log,
      props.loaded,
    );
    for (const fn of queue) fn();
  };
}
const ON = { "workspace.restoreLastProject": true };

// One launch: the page renders before the workspace has loaded, then loaded, then twice more with the same and with changed values.
function launch(props) {
  const opened = [];
  const logged = [];
  const render = mountRestore({
    openRecentProject: (project) => opened.push(project),
    log: (text) => logged.push(text),
  });
  const base = {
    loaded: false,
    userPreferences: ON,
    state: { connections: ALL },
    ...props,
  };
  render(base);
  const before = { opened: opened.length, logged: logged.length };
  render({ ...base, loaded: true });
  const after = { opened: opened.length, logged: logged.length };
  render({ ...base, loaded: true });
  render({ ...base, loaded: true, root: "/elsewhere" });
  render({ ...base, loaded: true, projectHistory: [] });
  return { opened, logged, before, after };
}

test("last-project tracer: with the setting on, the stored history and saved connections give one open of the most recent project through the real App block, once per launch; off, already open and another connection give none", () => {
  const stored = JSON.stringify([
    entry(local, "/w/a", 100),
    entry(sshA, "/w/b", 300, { rigId: "r1", rigName: "Team" }),
    entry(wsl, "/w/c", 200, { pinned: true }),
  ]);
  const projectHistory = ph.normalizeHistory(JSON.parse(stored));
  assert.deepEqual(
    projectHistory.map((p) => p.root),
    ["/w/c", "/w/b", "/w/a"],
    "the history order is pinned first, which is not the order launch uses",
  );
  const base = { projectHistory, connection: sshA, root: "/w/other" };

  // On: one open, of the newest project, with its rig, and only after the workspace has loaded.
  const run = launch(base);
  assert.deepEqual(run.before, { opened: 0, logged: 0 });
  assert.equal(run.opened.length, 1, "once per launch");
  assert.equal(run.after.opened, 1);
  assert.equal(run.opened[0].root, "/w/b");
  assert.equal(run.opened[0].connectionId, "ssh-a");
  assert.equal(run.opened[0].rigId, "r1");
  assert.equal(run.opened[0].rigName, "Team");
  assert.deepEqual(run.logged, []);

  // Off: nothing, whatever else is true.
  for (const userPreferences of [
    {},
    { "workspace.restoreLastProject": false },
    { "workspace.restoreLastProject": "true" },
  ]) {
    const off = launch({ ...base, userPreferences });
    assert.deepEqual([off.opened, off.logged], [[], []]);
  }

  // Launch already brought that project back: nothing opens and nothing is said.
  const same = launch({ ...base, root: "/w/b/" });
  assert.deepEqual([same.opened, same.logged], [[], []]);

  // The newest project is on a connection launch does not use: not opened, and the Activity log says so once.
  const other = launch({ ...base, connection: local, root: "/w/x" });
  assert.deepEqual(other.opened, []);
  assert.deepEqual(other.logged, [
    "Your last project is on another connection, so it was not reopened.",
  ]);

  // No history, or nothing available: nothing, quietly.
  assert.deepEqual(launch({ ...base, projectHistory: [] }).opened, []);
  const none = launch({ ...base, state: { connections: [] } });
  assert.deepEqual([none.opened, none.logged], [[], []]);
});

test("last-project pick: the newest project of an available connection wins whatever the pin, a pinned project wins a tie, unavailable or changed connections and malformed entries are skipped, and the platform is part of the identity", () => {
  const a = entry(local, "/w/a", 100);
  const b = entry(sshA, "/w/b", 300);
  const c = entry(wsl, "/w/c", 200, { pinned: true });
  const history = deepFreeze([a, c, b]);
  const connections = deepFreeze(ALL.map((connection) => ({ ...connection })));
  assert.deepEqual(pickLastProject(history, connections, OS), b);
  assert.equal(pickLastProject(history, [local, wsl, sshB], OS).id, c.id);
  assert.equal(pickLastProject(history, [local, sshA], OS).id, b.id);
  assert.equal(pickLastProject(history, [local], OS).id, a.id);
  assert.equal(pickLastProject(history, [], OS), null);
  assert.equal(pickLastProject([], ALL, OS), null);

  // Ties: a pinned project first, then the earlier entry.
  const t1 = entry(local, "/t/1", 500);
  const t2 = entry(wsl, "/t/2", 500);
  assert.equal(pickLastProject([t1, t2], ALL, OS).id, t1.id);
  assert.equal(pickLastProject([t2, t1], ALL, OS).id, t2.id);
  assert.equal(
    pickLastProject([t1, { ...t2, pinned: true }], ALL, OS).id,
    t2.id,
  );
  assert.equal(
    pickLastProject(
      [
        { ...t1, pinned: true },
        { ...t2, pinned: true },
      ],
      ALL,
      OS,
    ).id,
    t1.id,
  );

  // A connection that is gone or has changed does not count: other host, port, kind, id or distro.
  for (const changed of [
    { ...sshA, host: "evil.example" },
    { ...sshA, port: 2200 },
    { ...sshA, kind: "wsl" },
    { ...sshA, id: "ssh-z" },
  ])
    assert.equal(pickLastProject([b], [changed], OS), null);
  assert.equal(pickLastProject([c], [{ ...wsl, distro: "Debian" }], OS), null);

  // The platform is part of a local connection's identity, and an unknown platform is its own.
  const win = entry(local, "C:\\Work\\a", 100, {}, "win32");
  assert.equal(pickLastProject([win], [local], "win32").id, win.id);
  assert.equal(pickLastProject([win], [local], "linux"), null);
  assert.equal(pickLastProject([win], [local], undefined), null);
  assert.equal(pickLastProject([b], ALL, "win32").id, b.id);
  const unknown = entry(local, "/u", 1, {}, "unknown");
  for (const odd of [undefined, null, "", 5, {}])
    assert.equal(pickLastProject([unknown], [local], odd).id, unknown.id);

  // Malformed entries are dropped, a repeated id keeps its first entry.
  const junk = [
    null,
    undefined,
    5,
    "x",
    [],
    {},
    { id: "x" },
    { ...a, id: 5 },
    { ...a, root: "" },
    { ...a, root: "/a\0b" },
    { ...a, lastOpened: -1 },
    { ...a, lastOpened: NaN },
    { ...a, lastOpened: "9" },
    { ...a, hostName: "h".repeat(301) },
  ];
  assert.equal(pickLastProject(junk, ALL, OS), null);
  assert.equal(pickLastProject([...junk, a], ALL, OS).id, a.id);
  assert.equal(
    pickLastProject([a, { ...a, lastOpened: 999 }], ALL, OS).lastOpened,
    100,
  );
  for (const odd of [undefined, null, {}, "x", 5, true])
    assert.equal(pickLastProject(odd, ALL, OS), null);
  for (const odd of [undefined, null, {}, "x", 5, true])
    assert.equal(pickLastProject([a], odd, OS), null);
  // Odd connections in the list are ignored, the good one still counts.
  assert.equal(
    pickLastProject(
      [a],
      [null, 5, "x", {}, { id: 1, kind: "local" }, { id: "local" }, local],
      OS,
    ).id,
    a.id,
  );
});

test("last-project plan: nothing unless exactly enabled, then the newest project opens unless launch already has it or it is on a connection launch does not use, and the reason says which", () => {
  const a = entry(local, "/w/a", 100);
  const b = entry(sshA, "/w/b", 300);
  const c = entry(wsl, "/w/c", 200);
  const history = deepFreeze([a, b, c]);
  const plan = (extra) =>
    planLastProject({
      enabled: true,
      history,
      connections: ALL,
      platform: OS,
      active: { connection: sshA, root: "/w/x" },
      ...extra,
    });
  const off = { reason: "off", project: null };
  for (const enabled of [false, undefined, null, 0, 1, "true", "yes", {}, []])
    assert.deepEqual(plan({ enabled }), off);
  for (const input of [undefined, null, "x", 5, true, []])
    assert.deepEqual(planLastProject(input), off);
  assert.deepEqual(planLastProject(), off);

  // The newest project is on the connection launch uses: open.
  const open = plan({});
  assert.equal(open.reason, "open");
  assert.deepEqual(open.project, b);
  assert.deepEqual(Object.keys(open).sort(), ["project", "reason"]);

  // Nothing to open.
  assert.deepEqual(plan({ history: [] }), {
    reason: "no-project",
    project: null,
  });
  assert.deepEqual(plan({ connections: [] }), {
    reason: "no-project",
    project: null,
  });
  assert.deepEqual(plan({ history: [{ id: 1 }, null] }), {
    reason: "no-project",
    project: null,
  });

  // Launch already brought it back: the same connection and folder, a trailing slash or a Windows spelling included.
  for (const root of ["/w/b", "/w/b/"])
    assert.deepEqual(plan({ active: { connection: sshA, root } }), {
      reason: "already-open",
      project: null,
    });
  const winRow = entry(local, "C:\\Work\\A", 100, {}, "win32");
  const win = (root) =>
    planLastProject({
      enabled: true,
      history: [winRow],
      connections: [local],
      platform: "win32",
      active: { connection: local, root },
    });
  for (const root of ["C:\\Work\\A", "c:/work/a/", "C:/WORK/a"])
    assert.equal(win(root).reason, "already-open", root);
  assert.equal(win("C:\\Work\\B").reason, "open");
  // The same folder on another connection is another project.
  assert.equal(
    plan({ history: [a], active: { connection: wsl, root: "/w/a" } }).reason,
    "open",
    "a local project opens from any connection",
  );
  assert.equal(
    plan({ history: [b], active: { connection: local, root: "/w/b" } }).reason,
    "other-connection",
  );

  // A project on this computer opens from anywhere; another connection's project only when it is the one in use.
  assert.equal(
    plan({ history: [a], active: { connection: sshB, root: "/w/x" } }).reason,
    "open",
  );
  const elsewhere = [
    [c, local],
    [c, sshA],
    [b, local],
    [b, wsl],
    [b, sshB],
  ];
  for (const [project, connection] of elsewhere)
    assert.deepEqual(
      plan({
        history: [project],
        active: { connection, root: "/w/x" },
      }),
      { reason: "other-connection", project: null },
      project.connectionId + " from " + connection.id,
    );
  for (const [project, connection] of [
    [c, wsl],
    [b, sshA],
  ])
    assert.equal(
      plan({ history: [project], active: { connection, root: "/w/x" } }).reason,
      "open",
    );

  // The newest project decides: an older local project is not opened in its place.
  assert.equal(
    plan({ active: { connection: local, root: "/w/x" } }).reason,
    "other-connection",
  );
  // But a connection that is gone is skipped for the next most recent one.
  const skipped = plan({
    connections: [local, wsl],
    active: { connection: local, root: "/w/x" },
  });
  assert.equal(skipped.reason, "other-connection");
  assert.equal(skipped.project, null);
  const onlyLocal = plan({
    connections: [local],
    active: { connection: local, root: "/w/x" },
  });
  assert.equal(onlyLocal.reason, "open");
  assert.deepEqual(onlyLocal.project, a);

  // No usable active connection: this computer opens, anything else is left alone.
  for (const active of [
    undefined,
    null,
    {},
    { connection: null, root: "/w/a" },
    { connection: {}, root: "/w/a" },
    { connection: "local", root: "/w/a" },
    { connection: local, root: "" },
    { connection: local, root: 5 },
  ]) {
    assert.equal(plan({ history: [a], active }).reason, "open");
    assert.equal(plan({ history: [b], active }).reason, "other-connection");
  }
  assert.equal(
    plan({ platform: undefined, history: [a] }).reason,
    "no-project",
  );
});

test("last-project fuzz: random histories, connections and launch states always agree with a plain model, never throw and never open anything unavailable or unreachable", () => {
  const next = rng(18181818);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const ghost = { id: "ssh-ghost", name: "Ghost", kind: "ssh", host: "ghost" };
  const pool = [...ALL, ghost];
  const folders = ["/w/a", "/w/a/", "/w/b", "/w/c/", "/w/d"];
  const model = ({ history, connections, active }) => {
    const seen = new Set();
    const rows = history.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
    const available = rows.filter((row) =>
      connections.some(
        (c) =>
          c.id === row.connectionId &&
          ph.connectionIdentity(c, OS) === row.endpoint,
      ),
    );
    if (!available.length) return { reason: "no-project", id: null };
    let best = available[0];
    for (const row of available.slice(1))
      if (
        row.lastOpened > best.lastOpened ||
        (row.lastOpened === best.lastOpened && row.pinned && !best.pinned)
      )
        best = row;
    if (
      active.connection &&
      active.root &&
      ph.projectIdentity(active.connection, active.root, OS) === best.id
    )
      return { reason: "already-open", id: null };
    const target = connections.find((c) => c.id === best.connectionId);
    if (target.kind !== "local" && target.id !== active.connection?.id)
      return { reason: "other-connection", id: null };
    return { reason: "open", id: best.id };
  };
  const reasons = new Set();
  for (let i = 0; i < 800; i++) {
    const connections = pool.filter(() => next() < 0.6 && true);
    const history = [];
    const n = Math.floor(next() * 8);
    for (let k = 0; k < n; k++) {
      const connection = pick(pool);
      const row = entry(
        connection,
        pick(folders),
        (1 + Math.floor(next() * 4)) * 1000,
        { pinned: next() < 0.3 },
      );
      if (next() < 0.1)
        row.endpoint = ph.connectionIdentity({ ...connection, port: 9 }, OS);
      history.push(row);
    }
    const active = {
      connection: next() < 0.15 ? null : pick(pool),
      root: next() < 0.15 ? "" : pick(folders),
    };
    deepFreeze(history);
    const input = { enabled: true, history, connections, platform: OS, active };
    const plan = planLastProject(input);
    const expected = model({ history, connections, active });
    assert.equal(plan.reason, expected.reason, JSON.stringify(input));
    assert.equal(plan.project ? plan.project.id : null, expected.id);
    assert.equal(plan.reason === "open", plan.project !== null);
    assert.deepEqual(planLastProject(input), plan, "deterministic");
    const picked = pickLastProject(history, connections, OS);
    assert.equal(plan.reason === "no-project", picked === null);
    if (plan.project)
      assert.ok(
        connections.some(
          (c) =>
            c.id === plan.project.connectionId &&
            ph.connectionIdentity(c, OS) === plan.project.endpoint,
        ),
        "an opened project has an available connection",
      );
    reasons.add(plan.reason);
  }
  assert.deepEqual(
    [...reasons].sort(),
    ["already-open", "no-project", "open", "other-connection"],
    "the run covers every outcome",
  );
  // Hostile junk never throws.
  const junk = [undefined, null, 0, "", "x", NaN, [], {}, () => 1, Symbol("s")];
  for (const a of junk)
    for (const b of junk)
      for (const c of junk) {
        planLastProject({
          enabled: true,
          history: a,
          connections: b,
          active: c,
        });
        pickLastProject(a, b, c);
      }
});

test("last-project app: the App block runs once after the workspace has loaded, reads only the user setting, goes through the Welcome project path and nothing else, and logs when the project is on another connection", () => {
  const b = entry(sshA, "/w/b", 300);
  const history = ph.normalizeHistory([entry(local, "/w/a", 100), b]);
  const base = { projectHistory: history, connection: sshA, root: "/w/x" };

  // Not before the workspace has loaded, then exactly once; later renders never repeat it.
  const run = launch(base);
  assert.deepEqual(run.before, { opened: 0, logged: 0 });
  assert.equal(run.opened.length, 1);
  assert.equal(run.opened[0].id, b.id);

  // The project the page gets is the one the planner chose, untouched.
  assert.deepEqual(run.opened[0], b);

  // Another launch (a fresh page) decides again.
  assert.equal(launch(base).opened.length, 1);

  // Source: one planner call fed by the user setting, the history, the saved connections, the platform and the active connection.
  const app = read("src/App.tsx");
  const block = collapse(restoreBlock());
  assert.ok(
    block.includes(
      'const plan = planLastProject({ enabled: userPreferences["workspace.restoreLastProject"], history: projectHistory, connections: state.connections, platform: window.hrig.platform, active: { connection, root }, });',
    ),
  );
  assert.ok(
    block.includes(
      "if (!loaded || restoreChecked.current) return; restoreChecked.current = true;",
    ),
  );
  assert.ok(
    block.includes("if (plan.project) openRecentProject(plan.project);"),
  );
  assert.ok(block.endsWith("}, [loaded]);"));
  // Nothing in the block opens a dialog, a terminal or a seat, or talks to the main process itself.
  assert.ok(
    !/applyProject|setModal|setState|createTerminal|writeTerminal|sendMessage|rigAction|rigControl|saveState|\.file\(|\.git\(|openProject\(|connectionIdentity|sendTerminalCommand/.test(
      block,
    ),
  );
  assert.equal(count(block, "window.hrig"), 1, "only the platform is read");
  assert.equal(count(app, "planLastProject("), 1);
  assert.equal(count(app, "openRecentProject("), 1);
  assert.equal(count(app, 'from "./last-project"'), 1);
  assert.equal(count(app, "restoreChecked"), 3);
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .filter((name) => read("src/" + name).includes("./last-project"))
    .sort();
  assert.deepEqual(users, ["App.tsx"]);

  // The path it reuses is the Welcome row path, unchanged: the hub opens, applyProject checks the folder and fails closed.
  const open = collapse(
    app.slice(
      app.indexOf("const openRecentProject = "),
      app.indexOf("const restoreChecked"),
    ),
  );
  for (const part of [
    "const target = availableConnection( project, state.connections, window.hrig.platform, ); openProject(); if (!target) {",
    'setFormError( "This project\'s connection is unavailable or changed. Open the folder again on the intended host.", ); return; }',
    "void applyProject(project.root, target, project.rigId, project.rigName);",
  ])
    assert.ok(open.includes(part), part);
  const applied = app.slice(
    app.indexOf("const applyProject = async ("),
    app.indexOf("const openProject = () => {"),
  );
  assert.ok(
    collapse(applied).includes(
      'await window.hrig.file(target, { op: "list", root: path, path: "" });',
    ),
    "the folder check is still in applyProject",
  );
  // It only proceeds, and only shows an error, while the project dialog is the open one.
  assert.equal(count(applied, 'modalRef.current !== "project"'), 1);
  assert.equal(count(applied, 'modalRef.current === "project"'), 1);
});

test("last-project module: it is pure, imports only the history rules and the connection type, exports exactly the two functions and is plain ASCII", () => {
  assert.deepEqual(Object.keys(lib).sort(), [
    "pickLastProject",
    "planLastProject",
  ]);
  const raw = read("src/last-project.ts");
  assert.ok(isAscii(raw));
  const source = stripComments(raw);
  assert.equal(count(source, " from "), 2);
  assert.equal(count(source, 'import type { Connection } from "./types";'), 1);
  assert.equal(count(source, 'from "./project-history";'), 1);
  assert.ok(
    !/\b(window|document|navigator|localStorage|sessionStorage|fetch|process|require|setTimeout|setInterval|Date|console|Math)\b/.test(
      source,
    ),
  );
  assert.ok(!/\bany\b/.test(source));
  // The history rules it relies on are the existing ones, untouched.
  const history = read("src/project-history.ts");
  assert.equal(count(history, "export function availableConnection("), 1);
  assert.equal(count(history, "export function normalizeHistory("), 1);
  assert.equal(count(history, "export function projectIdentity("), 1);
  assert.equal(count(history, "last-project"), 0);
});

test("last-project docs: SETTINGS.md and NAVIGATION.md say that it is off by default, what it opens and when it does not, which checks it reuses and what it never does", () => {
  const settings = read("SETTINGS.md");
  assert.ok(!/[^\n -~…↑↓·→–]/.test(settings), "plain ASCII (plus the symbols the notification docs use)");
  const parts = settings.split("\n\n");
  const mine = parts.filter((part) =>
    part.startsWith("Reopen last project: `workspace.restoreLastProject`"),
  );
  assert.equal(mine.length, 1);
  const text = mine[0];
  for (const part of [
    "is off by default, and then HRig starts exactly as before",
    "launch already brings back your saved connection, folder and layouts",
    "once, after the workspace has loaded",
    "the newest entry of the project history whether or not it is pinned",
    "If launch already brought that project back, nothing changes",
    "for example because the saved folder or connection is gone",
    "the same Open project check as a project under Continue where you left off",
    "the folder must exist",
    "leaves the Open a project dialog showing its message and changes nothing else",
    "skipped for the next most recent one",
    "a project on another SSH or WSL connection than the one launch already uses is not opened for you",
    "the Activity log says so",
    "never reaches a host it would not reach anyway",
    "never starts or restarts a seat and never sends anything to a terminal",
    "read from your user settings only",
    "no project is open yet when it is read",
    "See NAVIGATION.md",
  ])
    assert.ok(text.includes(part), "SETTINGS.md says: " + part);
  const at = parts.indexOf(text);
  assert.ok(
    parts[at - 1].startsWith("Window title: `appearance.windowTitleDetails`") ||
      at > parts.findIndex((p) => p.startsWith("Status bar items: ")),
    "with the other setting notes",
  );
  assert.ok(
    at < parts.findIndex((p) => p.startsWith("Terminal bell: ")),
    "before the Terminal bell paragraph",
  );
  assert.ok(
    at > parts.findIndex((p) => p.startsWith("## Settings catalog")),
    "after the catalog",
  );

  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff, "the byte order mark stays");
  const nav = raw.slice(1);
  assert.ok(!/[^\n -~…↑↓·→–]/.test(nav), "plain ASCII (plus the symbols the Git info docs use)");
  assert.ok(nav.endsWith("\n") && !nav.endsWith("\n\n"));
  const lines = nav
    .split("\n")
    .filter((line) => line.startsWith("Reopen the last project: "));
  assert.equal(lines.length, 1);
  for (const part of [
    "Reopen the last project on launch turned on in Settings (Workspace, off by default)",
    "looks once at start, after your workspace has loaded",
    "the newest entry of the project history, pinned or not",
    "When launch has already brought that project back, nothing changes",
    "your layout, panels and sidebar stay as they were saved",
    "the saved folder or connection is gone",
    "the way a click under Continue where you left off does",
    "the Open a project dialog appears while HRig checks the folder",
    "stays open with its message when the check fails, in which case nothing else changes",
    "skipped for the next most recent one",
    "another SSH or WSL connection than the one launch already uses is left for you to open and the Activity log says so",
    "never reaches a host it would not reach anyway",
    "never starts or restarts a seat and never sends anything to a terminal",
    "read from your user settings only",
  ])
    assert.ok(lines[0].includes(part), "NAVIGATION.md says: " + part);
  assert.equal(count(nav, "\nReopen the last project: "), 1);
  // Both new notes are in place and the first one is untouched.
  assert.equal(count(nav, "\nWindow title: "), 1);
});
