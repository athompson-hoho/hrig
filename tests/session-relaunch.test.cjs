const test = require("node:test"),
  assert = require("node:assert/strict");
const { createSessionRelaunch } = require("../electron/session-relaunch.cjs");
function fixture() {
  const seat = {
    id: "rig:dev.impl",
    name: "dev.impl",
    session: "dev-impl@rig",
  };
  const calls = [];
  let eligible = true,
    clock = 1,
    fail = false;
  const execute = createSessionRelaunch({
    now: () => clock,
    inventory: async () => ({ seats: [seat] }),
    parseJson: JSON.parse,
    runRig: async (c, args) => {
      calls.push(args);
      if (args.includes("--help"))
        return "--fresh --stop --plan --reason --json";
      if (args.includes("--plan"))
        return JSON.stringify({
          complete: true,
          launchable: eligible,
          blockers: eligible
            ? []
            : [{ message: "Unmanaged seat cannot be replaced" }],
        });
      if (fail) throw Error("Connection lost after launch");
      return '{"ok":true}';
    },
  });
  const connection = {
    id: "host",
    kind: "ssh",
    host: "example.test",
    root: "/repo",
  };
  return {
    seat,
    calls,
    execute,
    connection,
    block: () => (eligible = false),
    expire: () => (clock += 300001),
    fail: () => (fail = true),
  };
}
test("single-seat relaunch requires reviewed target and explicit confirmation; its receipt cannot replay", async () => {
  const f = fixture(),
    { token } = await f.execute(f.connection, {
      op: "relaunchPlan",
      id: f.seat.id,
    });
  assert.ok(f.calls.every((a) => a.includes("--help") || a.includes("--plan")));
  const a = {
    op: "relaunch",
    id: f.seat.id,
    token,
    confirmation: "dev.impl",
    reason: "Requested $HOME; literal",
  };
  await assert.rejects(
    f.execute(f.connection, { ...a, confirmation: "wrong" }),
    /Type the session/,
  );
  await assert.rejects(
    f.execute({ ...f.connection, host: "other.test" }, a),
    /Review/,
  );
  await f.execute(f.connection, a);
  assert.deepEqual(f.calls.at(-1), [
    "seat",
    "launch",
    "dev-impl@rig",
    "--fresh",
    "--stop",
    "--reason",
    a.reason,
    "--json",
  ]);
  await assert.rejects(f.execute(f.connection, a), /Review/);
  assert.equal(
    f.calls.filter((a) => !a.includes("--help") && !a.includes("--plan"))
      .length,
    1,
  );
});
test("blocked, changed and expired seats cannot execute; failed writes never replay", async () => {
  for (const scenario of ["blocked", "changed", "expired", "failure"]) {
    const f = fixture(),
      { token } = await f.execute(f.connection, {
        op: "relaunchPlan",
        id: f.seat.id,
      });
    if (scenario === "blocked") f.block();
    if (scenario === "changed") f.seat.session = "replacement@rig";
    if (scenario === "expired") f.expire();
    if (scenario === "failure") f.fail();
    const a = {
      op: "relaunch",
      id: f.seat.id,
      token,
      confirmation: "dev.impl",
      reason: "Test",
    };
    await assert.rejects(f.execute(f.connection, a));
    await assert.rejects(f.execute(f.connection, a));
    assert.equal(
      f.calls.filter((a) => !a.includes("--help") && !a.includes("--plan"))
        .length,
      scenario === "failure" ? 1 : 0,
    );
  }
});
