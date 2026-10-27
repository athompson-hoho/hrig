const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGateway } = require("../electron/mobile-gateway.cjs");
test("mobile discovery identifies desktop selection and full task reads stay within the advertised queue", async (t) => {
  const receipts = [];
  const server = createGateway({
    token: "active-desktop-mobile-fixture-".repeat(2),
    activeConnection: async () => "ubuntu",
    connections: async () => [
      { id: "ssh", name: "First saved SSH", kind: "ssh" },
      { id: "ubuntu", name: "Ubuntu", kind: "wsl" },
    ],
    backend: { validateConnection() {}, queue: async () => [{ id: "task" }] },
    readTask: async (connection, id) => {
      receipts.push({ connection: connection.id, id });
      return { id, body: "Full task content", humanIntent: "Keep all details" };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  async function post(body) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + "active-desktop-mobile-fixture-".repeat(2),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, ...(await response.json()) };
  }
  assert.deepEqual((await post({ op: "connections" })).result, [
    { id: "ssh", name: "First saved SSH", selected: false, kind: "ssh" },
    { id: "ubuntu", name: "Ubuntu", selected: true, kind: "wsl" },
  ]);
  assert.equal(
    (await post({ op: "task", connectionId: "ubuntu", id: "task" })).result
      .body,
    "Full task content",
  );
  assert.equal(
    (await post({ op: "task", connectionId: "ubuntu", id: "unlisted-id" }))
      .status,
    400,
  );
  assert.equal(
    (await post({ op: "task", connectionId: "unapproved", id: "task" })).status,
    400,
  );
  assert.deepEqual(receipts, [{ connection: "ubuntu", id: "task" }]);
});
