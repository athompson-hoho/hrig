const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { pairingStore } = require("../electron/mobile-pairing.cjs");
const { mobileService } = require("../electron/mobile-service.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hrig-mobile-pair-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = Date.now();
  return {
    directory,
    store: pairingStore({ directory, now: () => time }),
    advance: (ms) => (time += ms),
  };
}
test("pairing invitations are single-use, require approval, persist only verifiers and revoke independently", (t) => {
  const f = fixture(t),
    s = f.store;
  const invitation = s.invite();
  assert.throws(
    () => s.request({ code: "incorrect", name: "Phone" }),
    /Invitation/,
  );
  const pending = s.request({ code: invitation.code, name: "Andrew's phone" });
  assert.equal(s.poll(pending).status, "pending");
  assert.throws(
    () => s.request({ code: invitation.code, name: "Other phone" }),
    /already used/,
  );
  assert.throws(
    () => s.poll({ ...pending, pollSecret: "wrong" }),
    /expired or cancelled/,
  );
  assert.equal(s.list().pending[0].phrase, pending.phrase);
  assert.equal(s.list().devices.length, 0);
  s.decide(pending.id, true);
  const approved = s.poll(pending);
  assert.equal(s.authenticate(approved.credential), true);
  assert.equal(s.authenticate("wrong"), false);
  const disk = fs.readFileSync(
    path.join(f.directory, "mobile-devices.json"),
    "utf8",
  );
  assert.ok(!disk.includes(approved.credential));
  assert.ok(!disk.includes(invitation.code));
  assert.ok(!JSON.stringify(s.list()).includes(approved.credential));
  const restarted = pairingStore({ directory: f.directory });
  assert.equal(restarted.authenticate(approved.credential), true);
  const next = s.request({ code: s.invite().code, name: "Second phone" });
  s.decide(next.id, true);
  const second = s.poll(next);
  s.revoke(approved.deviceId);
  assert.equal(s.authenticate(approved.credential), false);
  assert.equal(s.authenticate(second.credential), true);
  s.revoke("all");
  assert.equal(s.authenticate(second.credential), false);
  assert.throws(() => s.poll(next), /expired or cancelled/);
});
test("expiry, cancellation, denial, replacing invitations and brute-force limits fail closed", (t) => {
  const f = fixture(t),
    s = f.store;
  const expired = s.invite();
  f.advance(120001);
  assert.throws(
    () => s.request({ code: expired.code, name: "Phone" }),
    /expired/,
  );
  const old = s.invite();
  s.invite();
  assert.throws(() => s.request({ code: old.code, name: "Phone" }), /invalid/);
  const pending = s.request({ code: s.invite().code, name: "Phone" });
  s.decide(pending.id, false);
  assert.equal(s.poll(pending).status, "denied");
  assert.throws(() => s.decide(pending.id, true), /no longer pending/);
  const other = s.request({ code: s.invite().code, name: "Phone" });
  s.decide(other.id, true);
  const credential = s.poll(other).credential;
  f.advance(91 * 86400000);
  assert.equal(s.authenticate(credential), false);
  assert.throws(() => s.poll(other), /expired/);
  const cancelled = s.request({ code: s.invite().code, name: "Phone" });
  s.cancel();
  assert.throws(() => s.poll(cancelled), /expired or cancelled/);
  const phoneCancel = s.request({
    code: s.invite().code,
    name: "Cancel from phone",
  });
  assert.throws(
    () => s.cancelRequest({ ...phoneCancel, pollSecret: "wrong" }),
    /expired or cancelled/,
  );
  s.cancelRequest(phoneCancel);
  assert.throws(() => s.decide(phoneCancel.id, true), /no longer pending/);
  for (let n = 0; n < 31; n++) {
    try {
      s.request({ code: "x", name: "Phone" });
    } catch {}
  }
  assert.throws(
    () => s.request({ code: s.invite().code, name: "Phone" }),
    /Too many/,
  );
});
test("desktop TLS service serves approved devices, rejects revocation and preserves host identity on restart", async (t) => {
  const f = fixture(t);
  const service = mobileService({
    directory: f.directory,
    listenPort: 0,
    connections: async () => [{ kind: "wsl", id: "fixture", name: "Fixture" }],
  });
  t.after(() => service.stop());
  const started = await service.operation({ op: "start" });
  const invitation = JSON.parse(
    Buffer.from(
      (await service.operation({ op: "invite" })).payload.slice(6),
      "base64url",
    ).toString("utf8"),
  );
  function post(data, credential) {
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          hostname: "127.0.0.1",
          port: started.port,
          path: "/api",
          method: "POST",
          rejectUnauthorized: false,
          headers: {
            "Content-Type": "application/json",
            ...(credential
              ? { Authorization: `Bearer ${credential}` }
              : { "X-Hrig-Pairing": "1" }),
          },
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode, ...JSON.parse(body) }),
          );
        },
      );
      request.on("error", reject);
      request.end(JSON.stringify(data));
    });
  }
  const pending = (
    await post({
      op: "pair.request",
      code: invitation.code,
      name: "Fixture phone",
    })
  ).result;
  assert.equal((await post({ op: "connections" }, "unapproved")).status, 401);
  // Network callers cannot approve, even while holding the invitation/poll secret.
  assert.equal((await post({ op: "pair.approve", ...pending })).status, 400);
  await service.operation({ op: "approve", id: pending.id });
  const approved = (await post({ op: "pair.poll", ...pending })).result;
  assert.equal(
    (await post({ op: "connections" }, approved.credential)).status,
    200,
  );
  await service.operation({ op: "revoke", id: approved.deviceId });
  assert.equal(
    (await post({ op: "connections" }, approved.credential)).status,
    401,
  );
  service.stop();
  await service.operation({ op: "start" });
  const next = JSON.parse(
    Buffer.from(
      (await service.operation({ op: "invite" })).payload.slice(6),
      "base64url",
    ).toString("utf8"),
  );
  assert.equal(next.fingerprint, invitation.fingerprint);
  assert.equal(next.hostId, invitation.hostId);
});
