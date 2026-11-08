const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");

function load(entry) {
  const built = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const mod = new Module(entry, module);
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

const m = load("src/terminal-dropped.ts");
const commands = load("src/terminal-commands.ts");

const base = { rigControl: false, ended: null, error: "", ready: true };

test("a terminal that ended with exit code 0 or non-zero is dropped", () => {
  assert.equal(m.isDropped({ ...base, ended: 0 }), true);
  assert.equal(m.isDropped({ ...base, ended: 1 }), true);
});

test("an errored terminal that never became ready is dropped", () => {
  assert.equal(
    m.isDropped({ ...base, error: "host down", ready: false }),
    true,
  );
});

test("a connected terminal is not dropped", () => {
  assert.equal(m.isDropped(base), false);
});

test("a terminal that is still connecting is not dropped", () => {
  assert.equal(m.isDropped({ ...base, ready: false }), false);
});

test("a stray error on a ready terminal is not a drop", () => {
  assert.equal(m.isDropped({ ...base, error: "could not open link" }), false);
});

test("a terminal waiting on an automatic retry is still dropped", () => {
  assert.equal(m.isDropped({ ...base, ended: 255 }), true);
  assert.equal(m.isDropped({ ...base, error: "refused", ready: false }), true);
});

test("rig-control terminals are never dropped", () => {
  assert.equal(m.isDropped({ ...base, rigControl: true, ended: 1 }), false);
  assert.equal(
    m.isDropped({ ...base, rigControl: true, error: "x", ready: false }),
    false,
  );
});

test("no terminals means nothing to reconnect", () => {
  assert.deepEqual(m.droppedIds(new Set(), []), []);
  assert.deepEqual(m.droppedIds(new Set(), undefined), []);
  let calls = 0;
  assert.equal(
    m.reconnectAllDropped([], () => calls++),
    0,
  );
  assert.equal(calls, 0);
});

test("markDropped adds and removes one id without mutating its input", () => {
  const empty = new Set();
  const one = m.markDropped(empty, "a", true);
  assert.deepEqual([...one], ["a"]);
  assert.equal(empty.size, 0);
  const none = m.markDropped(one, "a", false);
  assert.equal(none.size, 0);
  assert.deepEqual([...one], ["a"]);
});

test("markDropped returns the same instance when membership is unchanged", () => {
  const one = m.markDropped(new Set(), "a", true);
  assert.equal(m.markDropped(one, "a", true), one);
  const empty = new Set();
  assert.equal(m.markDropped(empty, "a", false), empty);
});

test("markDropped ignores an empty id", () => {
  const empty = new Set();
  assert.equal(m.markDropped(empty, "", true), empty);
});

test("droppedIds keeps only open ids in open order and prunes closed terminals", () => {
  const reg = new Set(["c", "a", "gone"]);
  assert.deepEqual(m.droppedIds(reg, ["a", "b", "c"]), ["a", "c"]);
  assert.deepEqual(m.droppedIds(reg, ["a", "a", "c"]), ["a", "c"]);
  assert.deepEqual(m.droppedIds(reg), ["c", "a", "gone"]);
});

test("reconnectAllDropped sends each id once in order and returns the count", () => {
  const sent = [];
  assert.equal(
    m.reconnectAllDropped(["a", "b"], (id) => sent.push(id)),
    2,
  );
  assert.deepEqual(sent, ["a", "b"]);
});

test("reconnectAllDropped skips duplicates and empty ids", () => {
  const sent = [];
  assert.equal(
    m.reconnectAllDropped(["a", "", "a", "b", 7], (id) => sent.push(id)),
    2,
  );
  assert.deepEqual(sent, ["a", "b"]);
});

test("labels and notice wording", () => {
  assert.equal(m.droppedLabel(2), "Reconnect all dropped (2)");
  assert.equal(m.droppedLabel(0), "");
  assert.equal(m.reconnectNotice(0), "");
  assert.equal(m.reconnectNotice(1), "Reconnecting 1 terminal");
  assert.equal(m.reconnectNotice(3), "Reconnecting 3 terminals");
});

test("onTerminalDropped ignores malformed events and stops after unsubscribe", () => {
  globalThis.window = new EventTarget();
  const seen = [];
  const off = m.onTerminalDropped((id, dropped) => seen.push([id, dropped]));
  const fire = (detail) =>
    window.dispatchEvent(new CustomEvent(m.TERMINAL_DROPPED_EVENT, { detail }));
  fire({ id: "a", dropped: true });
  fire({ id: "", dropped: true });
  fire({ id: 5, dropped: true });
  fire({ id: "b", dropped: "yes" });
  fire(null);
  fire({});
  assert.deepEqual(seen, [["a", true]]);
  off();
  fire({ id: "c", dropped: true });
  assert.deepEqual(seen, [["a", true]]);
});

test("end to end: reconnect-dropped re-attaches only dropped, self-checking panels", () => {
  globalThis.window = new EventTarget();
  const attached = [];
  function panel(id, init) {
    const p = { id, state: { ...base, ...init }, attached: 0 };
    p.publish = () => {
      if (p.state.rigControl) return;
      m.publishTerminalDropped(id, m.isDropped(p.state));
    };
    window.addEventListener("hrig:terminal-command", (event) => {
      const { id: target, command } = event.detail;
      if (target !== id || p.state.rigControl) return;
      if (command === "reconnect-dropped" && m.isDropped(p.state)) {
        p.attached++;
        attached.push(id);
        p.state = { ...p.state, ended: null, error: "", ready: true };
        p.publish();
      }
    });
    p.publish();
    return p;
  }
  let registry = new Set();
  const off = m.onTerminalDropped((id, dropped) => {
    registry = m.markDropped(registry, id, dropped);
  });
  const ended = panel("ended", { ended: 1 });
  const errored = panel("errored", { error: "boom", ready: false });
  const connected = panel("connected", {});
  const rig = panel("rig", { rigControl: true, ended: 1 });
  const open = ["ended", "errored", "connected"];
  const ids = m.droppedIds(registry, open);
  assert.deepEqual(ids, ["ended", "errored"]);
  const count = m.reconnectAllDropped(ids, (id) =>
    commands.sendTerminalCommand(id, "reconnect-dropped"),
  );
  assert.equal(count, 2);
  assert.deepEqual(attached, ["ended", "errored"]);
  assert.equal(ended.attached, 1);
  assert.equal(errored.attached, 1);
  assert.equal(connected.attached, 0);
  assert.equal(rig.attached, 0);
  // Dispatching straight at a healthy panel is still ignored.
  commands.sendTerminalCommand("connected", "reconnect-dropped");
  commands.sendTerminalCommand("rig", "reconnect-dropped");
  assert.equal(connected.attached, 0);
  assert.equal(rig.attached, 0);
  assert.deepEqual(m.droppedIds(registry, open), []);
  off();
});
