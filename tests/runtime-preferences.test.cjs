const test = require("node:test"),
  assert = require("node:assert/strict");
test("runtime allocation favors configured plans while preserving independent review and authentication", async () => {
  const { allocateRuntimes, normalizeMonthlyBudgets } =
    await import("../electron/runtime-preferences.mjs");
  const providers = [
    { id: "codex", status: "authenticated" },
    { id: "claude-code", status: "authenticated" },
  ];
  const budgets = { codex: 100, "claude-code": 200 };
  assert.deepEqual(allocateRuntimes(providers, 2, budgets), [
    "claude-code",
    "codex",
  ]);
  assert.deepEqual(allocateRuntimes(providers, 4, budgets), [
    "claude-code",
    "codex",
    "claude-code",
    "claude-code",
  ]);
  assert.deepEqual(allocateRuntimes(providers, 1, budgets), ["claude-code"]);
  assert.equal(
    allocateRuntimes(providers, 4, { codex: 300, "claude-code": 100 })[0],
    "codex",
  );
  assert.deepEqual(
    allocateRuntimes(
      [
        { id: "codex", status: "authenticated" },
        { id: "claude-code", status: "missing" },
      ],
      2,
      budgets,
    ),
    ["codex", "codex"],
  );
  assert.deepEqual(
    allocateRuntimes(providers, 2, { codex: 0, "claude-code": 200 }, "codex"),
    ["codex", "claude-code"],
  );
  assert.throws(() => allocateRuntimes([], 2, budgets), /authenticated/);
  for (const invalid of [
    null,
    [],
    { codex: -1 },
    { codex: NaN },
    { codex: 10001 },
    { codex: "100" },
    { other: 100 },
  ])
    assert.throws(() => normalizeMonthlyBudgets(invalid));
});
test("plan metadata allows known labels without leaking arbitrary auth payloads", () => {
  const { safePlan } = require("../electron/account-plan.cjs");
  assert.equal(safePlan("prolite"), "Pro Lite");
  assert.equal(safePlan("Pro Lite"), "Pro Lite");
  assert.equal(safePlan("max_20x"), "Max 20x");
  for (const value of [
    null,
    {},
    "secret-token-do-not-render",
    "someone@example.test",
  ])
    assert.equal(safePlan(value), null);
});
test("Codex metadata uses only initialize and non-refreshing account/read and cleans up its own probe", async () => {
  const { PassThrough, Writable } = require("node:stream");
  const { EventEmitter } = require("node:events");
  const { codexPlan } = require("../electron/account-plan.cjs");
  const calls = [];
  let killed = false;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _enc, done) {
      for (const line of chunk.toString().trim().split("\n")) {
        const request = JSON.parse(line);
        calls.push(request);
        if (request.id === 1)
          setImmediate(() =>
            child.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\n"),
          );
        if (request.id === 2)
          setImmediate(() =>
            child.stdout.write(
              JSON.stringify({
                id: 2,
                result: {
                  account: {
                    planType: "prolite",
                    email: "private@example.test",
                    token: "never-return",
                  },
                },
              }) + "\n",
            ),
          );
      }
      done();
    },
  });
  child.kill = () => {
    killed = true;
  };
  const plan = await codexPlan({
    platform: "linux",
    spawnProcess: () => child,
    timeout: 1000,
  });
  assert.equal(plan, "Pro Lite");
  assert.deepEqual(
    calls.map((c) => c.method),
    ["initialize", "initialized", "account/read"],
  );
  assert.equal(calls[2].params.refreshToken, false);
  assert.equal(killed, true);
  const waiting = new EventEmitter();
  waiting.stdout = new PassThrough();
  waiting.stdin = new Writable({
    write(_c, _e, done) {
      done();
    },
  });
  waiting.kill = () => {
    killed = true;
  };
  assert.equal(
    await codexPlan({
      platform: "linux",
      spawnProcess: () => waiting,
      timeout: 10,
    }),
    null,
  );
});
