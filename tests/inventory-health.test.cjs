const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const built = buildSync({ entryPoints: ["src/inventory-health.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const mod = new Module("inventory-health", module);
mod._compile(built.outputFiles[0].text, "inventory-health");
const { shouldReport, pollDelay, formatAge, CHECKING_SNAPSHOT, failureOutcome } = mod.exports;
const base = { lastSuccessAt: 1000, now: 2000, intervalSeconds: 15 };
test("one or two failed polls are not reported; the third is", () => {
  assert.equal(shouldReport({ ...base, failures: 0 }), false);
  assert.equal(shouldReport({ ...base, failures: 1 }), false);
  assert.equal(shouldReport({ ...base, failures: 2 }), false);
  assert.equal(shouldReport({ ...base, failures: 3 }), true);
});
test("old data is reported even before the failure count", () => {
  assert.equal(shouldReport({ failures: 1, lastSuccessAt: 0, now: 61000, intervalSeconds: 15 }), true);
  assert.equal(shouldReport({ failures: 1, lastSuccessAt: 0, now: 59000, intervalSeconds: 15 }), false);
  assert.equal(shouldReport({ failures: 1, lastSuccessAt: 0, now: 100000, intervalSeconds: 60 }), false);
  assert.equal(shouldReport({ failures: 1, lastSuccessAt: 0, now: 241000, intervalSeconds: 60 }), true);
});
test("never having succeeded needs the full failure count", () => {
  assert.equal(shouldReport({ failures: 2, lastSuccessAt: null, now: 999999, intervalSeconds: 15 }), false);
  assert.equal(shouldReport({ failures: 3, lastSuccessAt: null, now: 0, intervalSeconds: 15 }), true);
});
test("polling retries quickly then backs off to a cap and never below the interval", () => {
  assert.equal(pollDelay(15, 0), 15000);
  assert.equal(pollDelay(15, 1), 5000);
  assert.equal(pollDelay(15, 2), 5000);
  assert.equal(pollDelay(15, 3), 30000);
  assert.equal(pollDelay(15, 4), 60000);
  assert.equal(pollDelay(15, 5), 120000);
  assert.equal(pollDelay(15, 50), 120000);
  assert.equal(pollDelay(3, 1), 3000);
  assert.equal(pollDelay(300, 3), 300000);
});
test("age reads as relative time", () => {
  assert.equal(formatAge(3000), "just now");
  assert.equal(formatAge(45000), "45 s ago");
  assert.equal(formatAge(120000), "2 min ago");
  assert.equal(formatAge(2 * 3600000), "2 h ago");
  assert.equal(formatAge(-5), "just now");
  assert.match(CHECKING_SNAPSHOT, /last successful snapshot/);
});
test("an unverified cached snapshot keeps its guard through brief failures", () => {
  const b = { lastSuccessAt: 1000, now: 2000, intervalSeconds: 15 };
  assert.equal(failureOutcome({ ...b, verified: false, failures: 1 }), "checking");
  assert.equal(failureOutcome({ ...b, verified: false, failures: 2 }), "checking");
  assert.equal(failureOutcome({ ...b, verified: false, failures: 3 }), "report");
  assert.equal(failureOutcome({ ...b, verified: true, failures: 1 }), "quiet");
  assert.equal(failureOutcome({ ...b, verified: true, failures: 3 }), "report");
  // an old cached snapshot is reported by age even on the first failure
  assert.equal(failureOutcome({ verified: false, failures: 1, lastSuccessAt: 0, now: 61000, intervalSeconds: 15 }), "report");
});
