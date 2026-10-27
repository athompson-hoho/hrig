const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const built = buildSync({
  entryPoints: ["src/team-tuning.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = new Module("team-tuning", module);
mod._compile(built.outputFiles[0].text, "team-tuning");
const { protectSeat, mergeTunedSeats, compareTeamSeats } = mod.exports;
const seat = (id, runtime = "codex") => ({ id, agentId: "builder", runtime });
test("tuning preserves edits across renames, repeated application and missing provider seats", () => {
  const original = seat("owner");
  const edited = {
    ...original,
    id: "lead",
    runtime: "claude-code",
    firstHandoff: { mission: "Manual mission" },
  };
  let protectedSeats = protectSeat([], original, edited);
  assert.deepEqual(
    mergeTunedSeats([original, seat("reviewer")], protectedSeats),
    [edited, seat("reviewer")],
  );
  assert.deepEqual(mergeTunedSeats([seat("reviewer")], protectedSeats), [
    seat("reviewer"),
    edited,
  ]);
  const next = { ...edited, id: "principal" };
  protectedSeats = protectSeat(protectedSeats, edited, next);
  assert.deepEqual(mergeTunedSeats([original], protectedSeats), [next]);
  assert.deepEqual(mergeTunedSeats([original], []), [original]);
});
test("tuning rejects overflow and protected-name collisions without dropping edits", () => {
  const edited = seat("manual");
  const protectedSeats = protectSeat([], seat("old"), edited);
  assert.throws(
    () =>
      mergeTunedSeats(
        Array.from({ length: 6 }, (_, i) => seat("new-" + i)),
        protectedSeats,
      ),
    /exceed six/,
  );
  const second = protectSeat(protectedSeats, seat("second"), { ...edited });
  assert.throws(() => mergeTunedSeats([], second), /names conflict/);
});
test("temporary duplicate names do not overwrite another seat's protection", () => {
  const first = seat("first");
  const second = seat("second");
  const firstEdit = { ...first, runtime: "claude-code" };
  const duplicate = { ...second, id: "first" };
  let protectedSeats = protectSeat([], first, firstEdit);
  protectedSeats = protectSeat(protectedSeats, second, duplicate);
  const corrected = { ...duplicate, id: "corrected" };
  protectedSeats = protectSeat(protectedSeats, duplicate, corrected);
  assert.deepEqual(mergeTunedSeats([first, second], protectedSeats), [
    firstEdit,
    corrected,
  ]);
});

test("comparison reports additions, removals, runtime and responsibility changes without modifying the drafts", () => {
  const before = [
    seat("owner"),
    {
      ...seat("checker"),
      firstHandoff: {
        mission: "Review",
        boundaries: "Original scope",
        expectedOutput: "Report",
        handoff: "Return to owner",
      },
    },
    seat("old"),
  ];
  const after = [
    seat("owner"),
    {
      ...before[1],
      runtime: "claude-code",
      firstHandoff: { ...before[1].firstHandoff, mission: "Review and test" },
    },
    seat("new"),
  ];
  const saved = JSON.stringify({ before, after });
  const diff = compareTeamSeats(before, after);
  assert.deepEqual(
    diff.added.map((s) => s.id),
    ["new"],
  );
  assert.deepEqual(
    diff.removed.map((s) => s.id),
    ["old"],
  );
  assert.deepEqual(
    diff.unchanged.map((s) => s.id),
    ["owner"],
  );
  assert.deepEqual(diff.changed[0].changes, [
    { label: "Runtime", before: "codex", after: "claude-code" },
    { label: "Mission", before: "Review", after: "Review and test" },
  ]);
  assert.equal(JSON.stringify({ before, after }), saved);
});
test("comparison uses the protected merged roster and exposes a changed coordination hub", () => {
  const owner = seat("owner");
  const reviewer = seat("reviewer");
  const edited = { ...owner, runtime: "claude-code" };
  const protectedSeats = protectSeat([], owner, edited);
  const merged = mergeTunedSeats([reviewer], protectedSeats);
  const diff = compareTeamSeats([edited, reviewer], merged);
  assert.equal(diff.hubBefore, "owner");
  assert.equal(diff.hubAfter, "reviewer");
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 2);
  assert.ok(diff.changed.every((s) => s.changes[0].label === "Position"));
});
test("comparison represents name changes as removal and addition and shows removed handoff fields", () => {
  const original = {
    ...seat("old"),
    firstHandoff: {
      mission: "Build",
      boundaries: "Scope",
      expectedOutput: "Patch",
      handoff: "Review",
    },
  };
  const renamed = compareTeamSeats([original], [{ ...original, id: "new" }]);
  assert.equal(renamed.added[0].id, "new");
  assert.equal(renamed.removed[0].id, "old");
  const cleared = compareTeamSeats([original], [seat("old")]);
  assert.equal(cleared.changed[0].changes.length, 4);
  assert.ok(cleared.changed[0].changes.every((c) => c.after === ""));
  assert.equal(compareTeamSeats([], []).changed.length, 0);
});
