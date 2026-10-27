// Local-only fixture administration for Orca native pairing QA; no live rigs.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { mobileService } = require("../../electron/mobile-service.cjs");
const directory = path.resolve(".hrig-test/native-pairing");
const service = mobileService({
  directory,
  connections: async () => [
    { id: "fixture", name: "Secure pairing fixture", kind: "wsl" },
  ],
  backend: {
    validateConnection: () => {},
    inventory: async () => ({
      rigs: [{ id: "rig", name: "Secure test rig", status: "running" }],
      seats: [
        {
          id: "seat",
          rigId: "rig",
          rigName: "Secure test rig",
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
        id: "task",
        title: "Verify native pinned TLS pairing",
        status: "active",
        destination: "builder",
      },
    ],
    quote: (value) => value,
    sessionCommand: () => {},
    remote: async () => "Pinned TLS verified. Fixture terminal, no live agent.",
  },
  runRig: async (_c, args) => {
    fs.appendFileSync(
      path.join(directory, "receipts.jsonl"),
      JSON.stringify(args) + "\n",
    );
    return "sent";
  },
});
const admin = http.createServer(async (req, res) => {
  try {
    if (req.method !== "POST") throw new Error("POST only");
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 4096) throw new Error("Too large");
    }
    const request = JSON.parse(text);
    const result = await service.operation(request);
    if (request.op === "invite") {
      // Standard Android emulator alias; real service invitations use host interfaces.
      const payload = JSON.parse(
        Buffer.from(result.payload.slice(6), "base64url").toString("utf8"),
      );
      payload.urls = ["https://10.0.2.2:5182"];
      result.payload =
        "hrig1:" + Buffer.from(JSON.stringify(payload)).toString("base64url");
      fs.writeFileSync(path.join(directory, "invitation.json"), result.payload);
    }
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(400).end(JSON.stringify({ error: e.message }));
  }
});
admin.listen(5183, "127.0.0.1", () =>
  console.log(
    "Native pairing fixture admin listening on loopback 5183. POST {op:start}, then {op:invite}.",
  ),
);
process.on("SIGINT", () => {
  service.stop();
  admin.close();
});
