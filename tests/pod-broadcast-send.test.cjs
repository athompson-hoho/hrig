"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { buildSync } = require("esbuild");

const load = (entry, id) => {
  const built = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const mod = new Module(id, module);
  mod.paths = module.paths;
  mod._compile(built.outputFiles[0].text, id);
  return mod.exports;
};
const { runPodBroadcast } = load("src/pod-broadcast-send.ts", "pod-broadcast-send");
const seat = (name, over = {}) => ({
  id: `r1:${name}`, rigId: "r1", rigName: "alpha", name, pod: "dev",
  runtime: "claude-code", model: "", session: `${name}@alpha`, status: "idle",
  activity: "", error: "", workCount: 0, ...over,
});

test("broadcast re-reads inventory before each recipient, skips changed seats, then sends the remaining exact preview", async () => {
  const initial = [seat("a"), seat("b"), seat("c")];
  let reads = 0;
  const sent = [];
  const results = await runPodBroadcast({
    seats: initial,
    selectedIds: ["r1:a", "r1:b", "r1:c"],
    text: "Please wait for review.",
    confirmation: "3",
    readInventory: async () => {
      reads++;
      return { seats: reads === 2 ? [initial[0], { ...initial[1], status: "stopped" }, initial[2]] : initial };
    },
    sendMessage: async (address, text) => { sent.push([address, text]); return "accepted"; },
    pause: async () => {},
  });
  assert.equal(reads, 3);
  assert.deepEqual(sent, [["a@alpha", "Please wait for review."], ["c@alpha", "Please wait for review."]]);
  assert.deepEqual(results.results.map((r) => r.status), ["accepted", "skipped", "accepted"]);
  assert.equal(results.results[1].reason, "stopped");
});

test("broadcast continues after an uncertain result and never retries the failed recipient", async () => {
  const seats = [seat("a"), seat("b"), seat("c")];
  const attempts = [];
  const results = await runPodBroadcast({
    seats,
    selectedIds: seats.map((s) => s.id),
    text: "Check in.",
    confirmation: "3",
    readInventory: async () => ({ seats }),
    sendMessage: async (address) => {
      attempts.push(address);
      if (address === "b@alpha") throw new Error("connection timed out");
      return "accepted";
    },
    pause: async () => {},
  });
  assert.deepEqual(attempts, ["a@alpha", "b@alpha", "c@alpha"]);
  assert.deepEqual(results.results.map((r) => r.status), ["accepted", "uncertain", "accepted"]);
  assert.match(results.results[1].reason, /connection timed out/);
});

test("broadcast requires valid text and the exact count confirmation before touching the adapter", async () => {
  let touched = false;
  const request = {
    seats: [seat("a")], selectedIds: ["r1:a"], text: "- dangerous option",
    confirmation: "1",
    readInventory: async () => { touched = true; return { seats: [seat("a")] }; },
    sendMessage: async () => { touched = true; },
  };
  const invalidText = await runPodBroadcast(request);
  assert.equal(invalidText.sent, false);
  assert.equal(touched, false);
  const invalidCount = await runPodBroadcast({ ...request, text: "hello", confirmation: "01" });
  assert.equal(invalidCount.sent, false);
  assert.equal(touched, false);
});
