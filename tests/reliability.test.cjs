const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { draftStore } = require("../electron/drafts.cjs");
const { integrationService } = require("../electron/integrations.cjs");
test("drafts survive restart, remain bounded, preserve the last good store, and support explicit cleanup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hrig-draft-test-"));
  const store = draftStore(dir);
  store({
    op: "put",
    key: "editor-1",
    value: { kind: "editor", data: { content: "unsaved", revision: "old" } },
  });
  assert.equal(
    draftStore(dir)({ op: "list" })["editor-1"].data.content,
    "unsaved",
  );
  assert.throws(
    () => store({ op: "put", key: "__proto__", value: { kind: "editor" } }),
    /key/,
  );
  const previous = fs.readFileSync(path.join(dir, "drafts.json"), "utf8");
  assert.throws(
    () =>
      store({
        op: "put",
        key: "oversized",
        value: { kind: "message", data: "a".repeat(4500000) },
      }),
    /oversized/,
  );
  assert.equal(
    fs.readFileSync(path.join(dir, "drafts.json"), "utf8"),
    previous,
  );
  store({ op: "delete", key: "editor-1" });
  assert.deepEqual(store({ op: "list" }), {});
  for (let i = 0; i < 100; i++)
    store({
      op: "put",
      key: String(i),
      value: { kind: "message", data: "draft" },
    });
  assert.throws(
    () =>
      store({
        op: "put",
        key: "101",
        value: { kind: "message", data: "draft" },
      }),
    /full/,
  );
  store({ op: "clear" });
  assert.deepEqual(store({ op: "list" }), {});
  fs.writeFileSync(path.join(dir, "drafts.json"), "{corrupt");
  assert.throws(() =>
    store({ op: "put", key: "safe", value: { kind: "message" } }),
  );
  assert.equal(
    fs.readFileSync(path.join(dir, "drafts.json"), "utf8"),
    "{corrupt",
  );
  store({ op: "clear" });
  assert.deepEqual(store({ op: "list" }), {});
});
test("GitHub boundaries use fixed CLI arguments, require explicit mutations, report partial lists, and never retry writes", async () => {
  const calls = [];
  const service = integrationService({
    directory: os.tmpdir(),
    safeStorage: { isEncryptionAvailable: () => false },
    runGh: async (args, input) => {
      calls.push({ args, input });
      return args.includes("--method")
        ? { number: 1 }
        : [
            {
              number: 1,
              title: "Task",
              body: "literal $(no)",
              html_url: "https://github.com/a/b/issues/1",
              state: "open",
            },
            { number: 2, pull_request: {} },
          ];
    },
  });
  await assert.rejects(
    service({ provider: "github", op: "list", repo: "-R evil" }),
    /owner/,
  );
  await assert.rejects(
    service({
      provider: "github",
      op: "create",
      repo: "a/b",
      title: "Task",
      body: "",
    }),
    /Confirm/,
  );
  assert.equal(calls.length, 0);
  const list = await service({ provider: "github", op: "list", repo: "a/b" });
  assert.equal(list.items.length, 1);
  await service({
    provider: "github",
    op: "create",
    repo: "a/b",
    title: "$(literal)",
    body: "hello\n`test`",
    confirmed: true,
  });
  assert.equal(calls[1].input.title, "$(literal)");
  assert.equal(calls[1].input.body, "hello\n`test`");
  assert.deepEqual(calls[1].args.slice(0, 3), [
    "api",
    "--hostname",
    "github.com",
  ]);
  await assert.rejects(
    service({
      provider: "github",
      op: "update",
      repo: "a/b",
      id: "--help",
      status: "closed",
      confirmed: true,
    }),
    /Invalid/,
  );
  await assert.rejects(
    service({ op: "connectLinear", key: "secret-key-never-plaintext" }),
    /plaintext/,
  );
});
test("Linear stores only encrypted credentials, handles HTTP and GraphQL errors, and disconnect removes the key", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hrig-linear-test-"));
  let fail = false;
  const requests = [];
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (k) => Buffer.from(k.split("").reverse().join("")),
    decryptString: (b) => b.toString().split("").reverse().join(""),
  };
  const service = integrationService({
    directory,
    safeStorage,
    request: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () =>
          fail
            ? { errors: [{ message: "denied secret-key-for-fixture" }] }
            : {
                data: {
                  viewer: { id: "viewer", name: "QA" },
                  issues: { nodes: [], pageInfo: { hasNextPage: true } },
                },
              },
      };
    },
  });
  await service({ op: "connectLinear", key: "secret-key-for-fixture" });
  assert.ok(
    !fs
      .readFileSync(path.join(directory, "linear-key.bin"))
      .includes(Buffer.from("secret-key-for-fixture")),
  );
  const result = await service({
    provider: "linear",
    op: "list",
    team: "team-id",
  });
  assert.equal(result.partial, true);
  assert.equal(requests[1].url, "https://api.linear.app/graphql");
  assert.deepEqual(JSON.parse(requests[1].options.body).variables.filter, {
    team: { id: { eq: "team-id" } },
  });
  fail = true;
  await assert.rejects(
    service({ provider: "linear", op: "list" }),
    (e) =>
      e.message.includes("[redacted]") && !e.message.includes("secret-key"),
  );
  await assert.rejects(service({ op: "disconnectLinear" }), /Confirm/);
  await service({ op: "disconnectLinear", confirmed: true });
  assert.equal(fs.existsSync(path.join(directory, "linear-key.bin")), false);
});
