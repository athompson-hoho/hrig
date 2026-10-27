const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/core.cjs");
const { createGateway } = require("../electron/mobile-gateway.cjs");
const { createWslFixture } = require("./wsl-fixture.cjs");
test(
  "mobile gateway captures a real managed tmux pane and reads full task details through WSL",
  { skip: process.platform !== "win32", timeout: 60000 },
  async (t) => {
    const fixture = await createWslFixture();
    if (!fixture) {
      t.skip("WSL not installed");
      return;
    }
    const server = createGateway({
      token: "real-tmux-mobile-fixture-".repeat(2),
      connections: async () => [fixture.connection],
    });
    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const inventory = await core.inventory(fixture.connection);
      await core.remote(
        fixture.connection,
        `tmux send-keys -t ${core.quote("=" + fixture.session + ":")} ${core.quote("printf 'HRIG_MOBILE_PANE_OK\\n'")} Enter`,
      );
      const post = async (body) => {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/api`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + "real-tmux-mobile-fixture-".repeat(2),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              connectionId: fixture.connection.id,
              ...body,
            }),
          },
        );
        const data = await response.json();
        assert.equal(response.status, 200, data.error);
        return data.result;
      };
      const text = await post({ op: "screen", seatId: inventory.seats[0].id });
      assert.match(text, /HRIG_MOBILE_PANE_OK/);
      const task = await post({ op: "task", id: "test-task" });
      assert.equal(task.body, "Fixture task details");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fixture.cleanup();
    }
  },
);
