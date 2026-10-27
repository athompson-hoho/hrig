import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ErrorBox } from "./components";

export default function MobileDevices() {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState<{
    payload: string;
    expiresAt: number;
  } | null>(null);
  const [qr, setQr] = useState(""),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let active = true,
      loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const value = await window.hrig.mobile({ op: "status" });
        if (active) {
          setState(value);
          if (value.pending.length || !value.running) setInvitation(null);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      setClock(Date.now());
      void load();
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setQr("");
    if (invitation)
      QRCode.toDataURL(invitation.payload, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: "M",
      })
        .then((value) => {
          if (active) setQr(value);
        })
        .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [invitation]);
  async function act(op: string, id?: string) {
    setBusy(true);
    setError("");
    try {
      const value = await window.hrig.mobile({ op, id });
      if (op === "invite") setInvitation(value);
      else {
        setState(value);
        if (["stop", "cancel", "approve", "deny"].includes(op))
          setInvitation(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const seconds = invitation
    ? Math.max(0, Math.ceil((invitation.expiresAt - clock) / 1000))
    : 0;
  return (
    <section className="mobile-devices">
      <h3>Mobile devices</h3>
      <p>
        Pair hRig on your phone with this computer. Access includes terminal
        viewing, tasks and sending agent messages.
      </p>
      {error && <ErrorBox error={error} />}
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}
      >
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => act(state?.running ? "stop" : "start")}
        >
          {state?.running ? "Stop mobile access" : "Start mobile access"}
        </button>
        <button
          className="primary-button"
          disabled={busy || !state?.running}
          onClick={() => act("invite")}
        >
          Pair a phone
        </button>
      </div>
      <p role="status">
        {state?.running
          ? `Listening securely on port ${state.port}. Windows firewall or tailnet policy must allow this port.`
          : "Mobile access is stopped. Starting it opens a TLS listener on this computer's network interfaces; unpaired devices cannot access your workspace."}
      </p>
      {state?.failure && <ErrorBox error={state.failure} />}
      {state?.running && (
        <ul>
          {state.addresses.map((a: any) => (
            <li key={a.url}>
              <code>{a.url}</code> — {a.kind}
            </li>
          ))}
        </ul>
      )}
      {invitation && (
        <div
          style={{
            border: "1px solid var(--line)",
            padding: 16,
            margin: "16px 0",
          }}
        >
          <h4>
            {seconds
              ? `Scan in hRig · expires in ${seconds}s`
              : "Invitation expired"}
          </h4>
          {seconds > 0 && (
            <>
              {qr && (
                <img
                  src={qr}
                  width={240}
                  height={240}
                  alt="Single-use hRig pairing invitation"
                />
              )}
              <p>
                Open hRig on the phone and choose Scan QR code. For manual
                pairing, copy the invitation below into the phone. It includes
                the computer's TLS identity.
              </p>
              <textarea
                aria-label="Pairing invitation"
                readOnly
                value={invitation.payload}
                style={{ width: "100%", height: 90 }}
              />
            </>
          )}
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => act("cancel")}
          >
            Cancel invitation
          </button>
        </div>
      )}
      {state?.pending.map((request: any) => (
        <article
          key={request.id}
          style={{
            border: "1px solid var(--line)",
            padding: 16,
            margin: "16px 0",
          }}
        >
          <h4>{request.name} wants to connect</h4>
          <p>
            Compare this phrase with the phone before approving:{" "}
            <strong>{request.phrase}</strong>
          </p>
          <p>
            Permission: monitor sessions and send messages. Expires{" "}
            {new Date(request.expiresAt).toLocaleTimeString()}.
          </p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => act("approve", request.id)}
          >
            Approve {request.name}
          </button>{" "}
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => act("deny", request.id)}
          >
            Deny
          </button>
        </article>
      ))}
      <h4>Paired phones</h4>
      {state && !state.devices.length && <p>No paired phones.</p>}
      {state?.devices.map((device: any) => (
        <div className="setting-row" key={device.id}>
          <div>
            <strong>{device.name}</strong>
            <p>
              {device.expired ? "Expired" : "Monitor and message"} · Approved{" "}
              {new Date(device.approvedAt).toLocaleDateString()} · Last
              connected{" "}
              {device.lastSeen
                ? new Date(device.lastSeen).toLocaleString()
                : "not yet"}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => act("revoke", device.id)}
          >
            Revoke {device.name}
          </button>
        </div>
      ))}
      {!!state?.devices.length && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            if (confirm("Revoke access for every paired phone?"))
              void act("revoke", "all");
          }}
        >
          Revoke all phones
        </button>
      )}
      <p>
        Invitations last two minutes and can be used once. Each device
        credential expires after 90 days. Gateway access stays off after
        restarting hRig until you start it here.
      </p>
    </section>
  );
}
