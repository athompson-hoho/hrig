// Reviewed quick message to ONE seat. `prepare` records the exact recipient and
// payload under a one-time token; `send` delivers exactly that and nothing else.
// Never auto-sends, never retries, never stores the payload beyond the token TTL.
const crypto = require("node:crypto");
const MAX_MESSAGE = 4000;
const TTL_MS = 120000;
const MAX_PENDING = 20;

function createSeatMessage({ inventory, runRig, now = Date.now, uuid = crypto.randomUUID }) {
  const pending = new Map();
  // Same tuple as the renderer's pinConnectionIdentity: a repointed saved
  // connection (other host, port, WSL distro or rig binary) never matches.
  const owner = (c) =>
    JSON.stringify([c.id, c.kind, c.host ?? null, c.port ?? null, c.distro ?? null, c.rigBinary ?? null]);
  const prune = () => {
    for (const [k, v] of pending) if (v.expires <= now()) pending.delete(k);
    while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
  };
  async function resolve(connection, id) {
    const seat = (await inventory(connection)).seats.find((s) => s.id === id);
    if (
      !seat ||
      !seat.session ||
      seat.session.startsWith("-") ||
      /[\s\0]/.test(seat.session)
    )
      throw Error("This session is no longer available. Refresh and select it again.");
    return seat;
  }
  async function prepare(connection, id, message) {
    if (typeof message !== "string" || !message.trim())
      throw Error("Enter a message first.");
    if (message.length > MAX_MESSAGE)
      throw Error(`Keep the message under ${MAX_MESSAGE} characters.`);
    message = message.replace(/\r\n/g, "\n");
    // The reviewed text must be exactly what the seat receives: refuse anything
    // that renders invisibly or acts as a keystroke (controls, ESC, bare CR,
    // DEL, C1, bidi/format characters, line/paragraph separators). \n and \t are fine.
    if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]|\p{Cf}/u.test(message))
      throw Error(
        "The message contains control or invisible formatting characters. Remove them and review again.",
      );
    const seat = await resolve(connection, id);
    prune();
    const token = uuid();
    pending.set(token, {
      owner: owner(connection),
      seatId: seat.id,
      session: seat.session,
      message,
      expires: now() + TTL_MS,
    });
    return {
      token,
      seatName: seat.name,
      rigName: seat.rigName,
      session: seat.session,
      payload: message,
      length: message.length,
      expiresInSeconds: TTL_MS / 1000,
    };
  }
  async function send(connection, id, token) {
    const plan = pending.get(token);
    pending.delete(token); // one use, success or failure: never retried automatically
    if (!plan || plan.expires <= now() || plan.owner !== owner(connection) || plan.seatId !== id)
      throw Error("This review expired. Review the message again before sending.");
    const seat = await resolve(connection, id);
    if (seat.session !== plan.session)
      throw Error("The recipient changed. Review the message again before sending.");
    await runRig(connection, ["send", plan.session, "--", plan.message]);
    return { delivered: true, session: plan.session, length: plan.message.length };
  }
  async function operation(connection, request) {
    if (request?.op === "prepare") return prepare(connection, request.id, request.message);
    if (request?.op === "send") return send(connection, request.id, request.token);
    throw Error("Unsupported message operation.");
  }
  return { operation, MAX_MESSAGE };
}
module.exports = { createSeatMessage, MAX_MESSAGE, TTL_MS };
