const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const secret = () => crypto.randomBytes(32).toString("base64url");
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

function pairingStore({ directory, now = Date.now }) {
  const file = path.join(directory, "mobile-devices.json");
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  state ||= { hostId: crypto.randomUUID(), devices: [] };
  let invite = null;
  const requests = new Map();
  let windowStart = now(),
    calls = 0;
  function save() {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  }
  save();
  function prune() {
    for (const [id, item] of requests)
      if (item.expiresAt <= now()) requests.delete(id);
    if (invite && invite.expiresAt <= now()) invite = null;
  }
  function list() {
    prune();
    return {
      hostId: state.hostId,
      invitationExpiresAt: invite?.expiresAt || null,
      pending: [...requests.values()]
        .filter((r) => r.status === "pending")
        .map(({ id, name, phrase, expiresAt }) => ({
          id,
          name,
          phrase,
          expiresAt,
        })),
      devices: state.devices.map(({ tokenHash, ...device }) => ({
        ...device,
        expired: device.expiresAt <= now(),
      })),
    };
  }
  return {
    hostId: state.hostId,
    list,
    invite() {
      invite = { code: secret(), expiresAt: now() + 120000 };
      // Replace also cancels requests made with the previous invitation.
      requests.clear();
      return { ...invite };
    },
    cancel() {
      invite = null;
      requests.clear();
    },
    request({ code, name }) {
      prune();
      if (now() - windowStart >= 60000) {
        windowStart = now();
        calls = 0;
      }
      if (++calls > 30)
        throw new Error(
          "Too many pairing attempts. Wait a minute and generate a new invitation.",
        );
      if (!invite || !equal(code, invite.code))
        throw new Error(
          "Invitation expired, already used, or invalid. Generate a new invitation on the computer.",
        );
      if (typeof name !== "string" || !name.trim() || name.length > 80)
        throw new Error("Enter a device name under 80 characters.");
      invite = null;
      const item = {
        id: crypto.randomUUID(),
        pollSecret: secret(),
        name: name.trim(),
        phrase: crypto
          .randomBytes(3)
          .toString("hex")
          .toUpperCase()
          .match(/.{2}/g)
          .join(" "),
        expiresAt: now() + 300000,
        status: "pending",
      };
      requests.set(item.id, item);
      return {
        id: item.id,
        pollSecret: item.pollSecret,
        phrase: item.phrase,
        expiresAt: item.expiresAt,
      };
    },
    poll({ id, pollSecret }) {
      prune();
      const item = requests.get(id);
      if (!item || !equal(pollSecret, item.pollSecret))
        throw new Error(
          "Pairing request expired or cancelled. Start again on the computer.",
        );
      return {
        status: item.status,
        phrase: item.phrase,
        expiresAt: item.expiresAt,
        ...(item.status === "approved"
          ? {
              credential: item.credential,
              deviceId: item.deviceId,
              deviceExpiresAt: item.deviceExpiresAt,
              hostId: state.hostId,
            }
          : {}),
      };
    },
    cancelRequest({ id, pollSecret }) {
      prune();
      const item = requests.get(id);
      if (!item || !equal(pollSecret, item.pollSecret))
        throw new Error("Pairing request expired or cancelled.");
      if (item.deviceId) {
        state.devices = state.devices.filter((d) => d.id !== item.deviceId);
        save();
      }
      requests.delete(id);
      return { status: "cancelled" };
    },
    decide(id, approved) {
      prune();
      const item = requests.get(id);
      if (!item || item.status !== "pending")
        throw new Error("This request is no longer pending.");
      if (!approved) {
        item.status = "denied";
        return;
      }
      if (state.devices.filter((d) => d.expiresAt > now()).length >= 32)
        throw new Error(
          "Revoke an old device before adding more devices (limit 32).",
        );
      const credential = secret(),
        deviceId = crypto.randomUUID(),
        expiresAt = now() + 90 * 86400000;
      state.devices.push({
        id: deviceId,
        name: item.name,
        tokenHash: hash(credential),
        approvedAt: now(),
        lastSeen: null,
        expiresAt,
        permissions: ["monitor", "message"],
      });
      save();
      Object.assign(item, {
        status: "approved",
        credential,
        deviceId,
        deviceExpiresAt: expiresAt,
      });
    },
    authenticate(credential) {
      const device = state.devices.find(
        (d) => equal(hash(credential), d.tokenHash) && d.expiresAt > now(),
      );
      if (!device) return false;
      const previous = device.lastSeen;
      device.lastSeen = now();
      if (!previous || now() - previous > 60000) {
        // Last-seen metadata must not turn a valid request into a desktop crash
        // if storage becomes temporarily unavailable. Approval/revocation still
        // require a successful write before reporting success.
        try {
          save();
        } catch {}
      }
      return true;
    },
    revoke(id) {
      state.devices =
        id === "all" ? [] : state.devices.filter((d) => d.id !== id);
      // A previously approved pending poll must not hand a revoked credential out again.
      for (const [key, item] of requests)
        if (id === "all" || item.deviceId === id) requests.delete(key);
      save();
    },
  };
}
module.exports = { pairingStore };
