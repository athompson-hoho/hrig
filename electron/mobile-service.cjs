const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { X509Certificate } = require("node:crypto");
const { pairingStore } = require("./mobile-pairing.cjs");
const { createGateway } = require("./mobile-gateway.cjs");

function mobileService({
  directory,
  connections,
  activeConnection,
  assets,
  backend,
  runRig,
  readTask,
  listenPort = 5182,
}) {
  let server = null,
    pairing = null,
    fingerprint = "",
    port = listenPort,
    failure = "",
    starting = false;
  const store = () => (pairing ||= pairingStore({ directory }));
  const addresses = () => {
    const values = [];
    for (const list of Object.values(os.networkInterfaces()))
      for (const item of list || []) {
        if (
          item.family === "IPv4" &&
          !item.internal &&
          !item.address.startsWith("169.254.")
        )
          values.push({
            url: `https://${item.address}:${port}`,
            kind: item.address.startsWith("100.")
              ? "Tailscale / VPN"
              : "LAN / network",
          });
      }
    return [...new Map(values.map((value) => [value.url, value])).values()]
      .sort(
        (a, b) =>
          Number(b.kind.startsWith("Tailscale")) -
          Number(a.kind.startsWith("Tailscale")),
      )
      .slice(0, 8);
  };
  const status = () => ({
    running: !!server?.listening,
    starting,
    failure,
    port,
    name: os.hostname(),
    addresses: addresses(),
    ...store().list(),
  });
  async function start() {
    if (server?.listening || starting) return status();
    starting = true;
    try {
      const certFile = path.join(directory, "mobile-tls.json");
      let tls;
      try {
        tls = JSON.parse(await fs.readFile(certFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const after = new Date();
        after.setFullYear(after.getFullYear() + 5);
        const pem = await require("selfsigned").generate(
          [{ name: "commonName", value: "hRig-" + store().hostId }],
          {
            keyType: "rsa",
            keySize: 2048,
            algorithm: "sha256",
            notAfterDate: after,
          },
        );
        tls = { key: pem.private, cert: pem.cert };
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(certFile + ".tmp", JSON.stringify(tls), {
          mode: 0o600,
        });
        await fs.rename(certFile + ".tmp", certFile);
      }
      fingerprint = new X509Certificate(tls.cert).fingerprint256
        .replaceAll(":", "")
        .toLowerCase();
      server = createGateway({
        auth: store(),
        tls,
        connections,
        activeConnection,
        assets,
        backend,
        runRig,
        readTask,
      });
      server.requestTimeout = 15000;
      server.headersTimeout = 10000;
      server.maxConnections = 64;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", resolve);
      });
      port = server.address().port;
      server.on("error", (error) => {
        failure = error.message;
      });
      failure = "";
    } catch (error) {
      server?.close();
      server = null;
      failure = error.message;
      throw error;
    } finally {
      starting = false;
    }
    return status();
  }
  function stop() {
    pairing?.cancel();
    server?.closeAllConnections();
    server?.close();
    server = null;
    return pairing
      ? status()
      : {
          running: false,
          starting: false,
          pending: [],
          devices: [],
          addresses: [],
          port,
        };
  }
  return {
    stop,
    async operation(request) {
      switch (request.op) {
        case "status":
          return status();
        case "start":
          return start();
        case "stop":
          return stop();
        case "invite": {
          if (!server?.listening) throw new Error("Start mobile access first.");
          const urls = addresses().map((a) => a.url);
          if (!urls.length)
            throw new Error(
              "No network address found. Connect LAN or Tailscale first.",
            );
          const invitation = store().invite();
          return {
            payload:
              "hrig1:" +
              Buffer.from(
                JSON.stringify({
                  v: 1,
                  hostId: store().hostId,
                  name: os.hostname(),
                  urls,
                  fingerprint,
                  ...invitation,
                }),
              ).toString("base64url"),
            expiresAt: invitation.expiresAt,
          };
        }
        case "cancel":
          store().cancel();
          return status();
        case "approve":
          store().decide(request.id, true);
          return status();
        case "deny":
          store().decide(request.id, false);
          return status();
        case "revoke":
          store().revoke(request.id);
          return status();
        default:
          throw new Error("Unknown mobile device operation.");
      }
    },
  };
}
module.exports = { mobileService };
