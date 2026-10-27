const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("./core.cjs");
const features = require("./features.cjs");

// Deliberately separate from Electron IPC: only host-approved connections and
// these four operations are available to a paired phone.
function createGateway({
  token,
  auth,
  tls,
  connections,
  assets,
  backend = core,
  runRig = features.runRig,
}) {
  if (!auth && (typeof token !== "string" || token.length < 32))
    throw new Error("HRIG_MOBILE_TOKEN must contain at least 32 characters.");
  const origins = new Set([
    "capacitor://localhost",
    "http://localhost",
    "https://localhost",
  ]);
  const serverModule = tls ? require("node:https") : http;
  return serverModule.createServer(tls || {}, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const origin = req.headers.origin;
    const ownOrigin = `http://${req.headers.host}`;
    if (
      origin &&
      !origins.has(origin) &&
      origin !== ownOrigin &&
      origin !== `https://${req.headers.host}`
    ) {
      res.writeHead(403).end();
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Hrig-Pairing",
      );
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api") {
      req.setEncoding("utf8");
      // Pairing invitations are single-use and cannot access workspace APIs.
      // Device approval is available exclusively through trusted desktop IPC.
      if (
        auth &&
        req.method === "POST" &&
        req.headers["x-hrig-pairing"] === "1"
      ) {
        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 4096)
              throw new Error("Pairing request is too large.");
          }
          const request = JSON.parse(body);
          const result =
            request.op === "pair.request"
              ? auth.request(request)
              : request.op === "pair.poll"
                ? auth.poll(request)
                : request.op === "pair.cancel"
                  ? auth.cancelRequest(request)
                  : null;
          if (!result) throw new Error("Unknown pairing operation.");
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ result }));
        } catch (error) {
          res
            .writeHead(400, { "Content-Type": "application/json" })
            .end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      const supplied = crypto
        .createHash("sha256")
        .update(req.headers.authorization || "")
        .digest();
      const expected = crypto
        .createHash("sha256")
        .update(`Bearer ${token}`)
        .digest();
      if (
        auth
          ? !auth.authenticate(
              (req.headers.authorization || "").replace(/^Bearer /, ""),
            )
          : !crypto.timingSafeEqual(supplied, expected)
      ) {
        res
          .writeHead(401, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "Pairing key rejected." }));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 65536) {
            res.writeHead(413).end();
            return;
          }
        }
        const request = JSON.parse(body);
        const saved = await connections();
        let result;
        if (request.op === "connections") {
          result = saved
            .filter((c) => c.kind !== "local")
            .map((c) => ({ id: c.id, name: c.name }));
        } else {
          const connection = saved.find(
            (c) => c.id === request.connectionId && c.kind !== "local",
          );
          if (!connection)
            throw new Error("Choose a connection saved on the HRig host.");
          backend.validateConnection(connection);
          if (request.op === "inventory")
            result = await backend.inventory(connection);
          else if (request.op === "queue")
            result = await backend.queue(connection);
          else if (request.op === "message" || request.op === "screen") {
            const inventory = await backend.inventory(connection);
            const seat = inventory.seats.find((s) => s.id === request.seatId);
            if (!seat)
              throw new Error("Seat no longer exists. Refresh sessions.");
            if (request.op === "message") {
              if (
                typeof request.message !== "string" ||
                !request.message.trim() ||
                request.message.length > 50000
              )
                throw new Error("Enter a message under 50,000 characters.");
              result = await runRig(connection, [
                "send",
                `${seat.name}@${seat.rigName}`,
                request.message,
              ]);
            } else {
              if (!seat.session)
                throw new Error("This seat has no live terminal.");
              // Capture only the current managed seat, never a caller-supplied shell command.
              backend.sessionCommand(seat.session);
              result = await backend.remote(
                connection,
                `tmux capture-pane -p -J -S -200 -t ${backend.quote("=" + seat.session)}`,
              );
            }
          } else throw new Error("Unknown mobile operation.");
        }
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ result }));
      } catch (error) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    if (req.method !== "GET" || !assets) {
      res.writeHead(404).end();
      return;
    }
    try {
      const relative = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      const file = path.resolve(assets, "." + relative);
      if (!file.startsWith(path.resolve(assets) + path.sep))
        throw new Error("Invalid path");
      const data = await fs.readFile(file);
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      );
      res
        .writeHead(200, {
          "Content-Type":
            types[path.extname(file)] || "application/octet-stream",
        })
        .end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
}

if (require.main === module) {
  const os = require("node:os");
  const stateFile = path.join(
    process.env.HRIG_DATA_DIR ||
      path.join(process.env.APPDATA || os.homedir(), "hrig"),
    "workspace.json",
  );
  try {
    const server = createGateway({
      token: process.env.HRIG_MOBILE_TOKEN,
      assets: path.join(__dirname, "../dist-mobile"),
      connections: async () =>
        JSON.parse(await fs.readFile(stateFile, "utf8")).connections || [],
    });
    const host = process.env.HRIG_MOBILE_HOST || "127.0.0.1";
    const port = Number(process.env.HRIG_MOBILE_PORT || 5180);
    server.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(port, host, () =>
      console.log(
        `HRig companion listening on http://${host}:${port}. Keep the pairing key private.`,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { createGateway };
