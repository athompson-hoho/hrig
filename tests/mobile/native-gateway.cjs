// Isolated gateway for manual/native emulator testing. Never contacts live rigs.
const { createGateway } = require("../../electron/mobile-gateway.cjs");
const path = require("node:path");
const server = createGateway({
  token: "native-emulator-fixture-key-12345678",
  assets: path.resolve(__dirname, "../../dist-mobile"),
  connections: async () => [
    { id: "fixture", name: "Emulator test machine", kind: "wsl" },
  ],
  backend: {
    validateConnection: () => {},
    inventory: async () => ({
      rigs: [{ id: "team", name: "Mobile test team", status: "running" }],
      seats: [
        {
          id: "builder",
          rigId: "team",
          rigName: "Mobile test team",
          name: "builder",
          runtime: "codex",
          status: "working",
          session: "fixture",
        },
      ],
      sampledAt: new Date().toISOString(),
    }),
    queue: async () => [
      {
        id: "task-1",
        title: "Validate native Android companion",
        status: "active",
        destination: "builder",
      },
    ],
    sessionCommand: () => {},
    quote: (value) => value,
    remote: async () =>
      "Native Android companion test\nFixture terminal output. No live agent attached.",
  },
  runRig: async (_connection, args) => {
    console.log("Fixture message receipt:", JSON.stringify(args));
    return "sent";
  },
});
server.listen(5181, "127.0.0.1", () =>
  console.log(
    "Fixture gateway: http://10.0.2.2:5181 (Android emulator host alias)",
  ),
);
