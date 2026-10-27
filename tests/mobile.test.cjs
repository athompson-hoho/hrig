const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGateway } = require("../electron/mobile-gateway.cjs");
const token = "a".repeat(40);

test("mobile gateway requires a strong pairing key", () => {
  assert.throws(() => createGateway({ token: "short" }), /32 characters/);
});

test("mobile gateway authenticates, confines connections, resolves seats and rejects arbitrary commands", async (t) => {
  const receipts = [];
  const backend = {
    validateConnection: () => {},
    inventory: async () => ({
      rigs: [],
      seats: [
        { id: "seat-1", name: "builder", rigName: "team", session: "managed" },
      ],
    }),
    queue: async () => [{ id: "task-1" }],
    quote: (value) => "'" + value + "'",
    sessionCommand: () => {},
    remote: async (_c, command) => {
      receipts.push(command);
      return "terminal screen";
    },
  };
  const server = createGateway({
    token,
    backend,
    runRig: async (_c, args) => {
      receipts.push(args);
      return "sent";
    },
    connections: async () => [
      { id: "approved", name: "WSL", kind: "wsl" },
      { id: "local", kind: "local" },
    ],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const post = (body, headers = {}) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post({ op: "connections" }, { Authorization: "Bearer wrong" }))
      .status,
    401,
  );
  assert.equal(
    (await post({ op: "connections" }, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.deepEqual((await (await post({ op: "connections" })).json()).result, [
    { id: "approved", name: "WSL" },
  ]);
  assert.equal(
    (
      await post({
        op: "inventory",
        connectionId: "unapproved",
        connection: { kind: "ssh", host: "evil" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await post({ op: "inventory", connectionId: "local" })).status,
    400,
  );
  assert.equal(
    (await post({ op: "execute", connectionId: "approved", command: "whoami" }))
      .status,
    400,
  );
  assert.equal(
    (await post({ op: "screen", connectionId: "approved", seatId: "unknown" }))
      .status,
    400,
  );
  const screen = await (
    await post({
      op: "screen",
      connectionId: "approved",
      seatId: "seat-1",
      session: "attacker",
    })
  ).json();
  assert.equal(screen.result, "terminal screen");
  assert.match(receipts[0], /'=managed:'/);
  assert.equal(
    (
      await post({
        op: "message",
        connectionId: "approved",
        seatId: "seat-1",
        message: "  ",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post({
        op: "message",
        connectionId: "approved",
        seatId: "seat-1",
        message: "status?",
      })
    ).status,
    200,
  );
  assert.deepEqual(receipts[1], ["send", "builder@team", "status?"]);
  assert.equal(
    (await post({ op: "connections", padding: "x".repeat(70000) })).status,
    413,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "OPTIONS",
        headers: { Origin: "capacitor://localhost" },
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await post({ op: "connections" }, { Origin: "capacitor://localhost" })
    ).headers.get("Access-Control-Allow-Origin"),
    "capacitor://localhost",
  );
});
