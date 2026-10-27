import { useEffect, useState, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import {
  loadProfiles,
  parseInvitation,
  pollPairing,
  cancelPairing,
  LinkError,
  reconnectProfile,
  saveProfiles,
  startPairing,
  type HostProfile,
  type Invitation,
} from "./link";

export default function PairComputer({
  onConnect,
  onLegacy,
  autoConnect,
}: {
  onConnect(profile: HostProfile, hosts: { id: string; name: string }[]): void;
  onLegacy(): void;
  autoConnect: boolean;
}) {
  const [profiles, setProfiles] = useState<HostProfile[]>([]),
    [text, setText] = useState(""),
    [name, setName] = useState("My phone"),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [retrySaved, setRetrySaved] = useState(true),
    [manual, setManual] = useState(false),
    [invitation, setInvitation] = useState<Invitation | null>(null),
    [pending, setPending] = useState<Awaited<
      ReturnType<typeof startPairing>
    > | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  async function connect(
    profile: HostProfile,
    values: HostProfile[] = profiles,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await reconnectProfile(profile);
      if (!mounted.current) return;
      await saveProfiles([
        result.profile,
        ...values.filter((p) => p.hostId !== profile.hostId),
      ]);
      if (mounted.current) onConnect(result.profile, result.hosts);
    } catch (e) {
      if (e instanceof LinkError && e.status === 401) setRetrySaved(false);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    loadProfiles()
      .then((values) => {
        if (active) {
          setProfiles(values);
          if (autoConnect && values[0]) void connect(values[0], values);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (
      !autoConnect ||
      !retrySaved ||
      !profiles[0] ||
      busy ||
      manual ||
      invitation ||
      pending
    )
      return;
    const timer = setTimeout(() => {
      void connect(profiles[0]);
    }, 15000);
    return () => clearTimeout(timer);
  }, [profiles, autoConnect, retrySaved, busy, manual, invitation, pending]);
  async function invite(value: string) {
    setError("");
    try {
      setInvitation(parseInvitation(value));
      setPending(null);
      setManual(false);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function scan() {
    setError("");
    setBusy(true);
    try {
      const { CapacitorBarcodeScanner } =
        await import("@capacitor/barcode-scanner");
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: 0,
        scanInstructions:
          "Scan the QR code in hRig desktop Settings > Mobile devices",
        cancelButtonAccessibilityLabel: "Cancel pairing scan",
      });
      if (result.ScanResult) await invite(result.ScanResult);
    } catch {
      setManual(true);
      setError(
        "Camera unavailable or scan cancelled. You can paste the desktop invitation instead.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!invitation || !pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() > pending.expiresAt) {
        setError("Approval expired. Generate a new invitation on the desktop.");
        setPending(null);
        return;
      }
      try {
        const result = await pollPairing(invitation, pending);
        if (stopped) return;
        if (result.status === "denied") {
          setError(
            "The computer denied this phone. Start again if this was unexpected.",
          );
          setPending(null);
          return;
        }
        if (result.status === "approved") {
          const profile: HostProfile = {
            hostId: invitation.hostId,
            name: invitation.name,
            urls: invitation.urls,
            fingerprint: invitation.fingerprint,
            credential: result.credential,
            deviceId: result.deviceId,
            expiresAt: result.deviceExpiresAt,
            activeURL: pending.url,
          };
          const values = [
            profile,
            ...profiles.filter((p) => p.hostId !== profile.hostId),
          ];
          await saveProfiles(values);
          if (stopped) return;
          setPending(null);
          setProfiles(values);
          await connect(profile, values);
          return;
        }
        setError("");
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pending, invitation]);
  async function forget(profile: HostProfile) {
    if (
      !confirm(
        `Forget ${profile.name}? This removes its saved credential from this phone. Revoke this phone on the desktop to invalidate its access there.`,
      )
    )
      return;
    try {
      const values = profiles.filter((p) => p.hostId !== profile.hostId);
      await saveProfiles(values);
      setProfiles(values);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="pair">
      <div className="eyebrow">YOUR WORKSPACE, WITH YOU</div>
      <h1>
        {pending ? (
          "Confirm your phone."
        ) : invitation ? (
          "Review connection."
        ) : (
          <>
            Connect your
            <br />
            computer.
          </>
        )}
      </h1>
      {!pending && (
        <p>In hRig desktop, open Settings → Mobile devices → Pair a phone.</p>
      )}
      {!invitation &&
        profiles.map((profile) => (
          <article key={profile.hostId}>
            <strong>{profile.name}</strong>
            <p>Remembered computer · encrypted device credential</p>
            <button disabled={busy} onClick={() => connect(profile)}>
              Connect to {profile.name}
            </button>{" "}
            <button disabled={busy} onClick={() => forget(profile)}>
              Forget this computer
            </button>
          </article>
        ))}
      {!invitation && Capacitor.isNativePlatform() && (
        <button className="primary" disabled={busy} onClick={scan}>
          Scan QR code
        </button>
      )}
      {!invitation && (
        <button
          disabled={busy}
          onClick={() => setManual(!manual)}
          style={{ margin: 8 }}
        >
          Enter pairing details
        </button>
      )}
      {manual && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void invite(text);
          }}
        >
          <label>
            Desktop invitation
            <textarea
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the invitation from your computer"
            />
          </label>
          <button disabled={busy}>Review invitation</button>
        </form>
      )}
      {invitation && !pending && (
        <article>
          <h2>{invitation.name}</h2>
          <p>
            Allow this phone to view sessions and send agent messages. The
            connection will be encrypted and pinned to the computer shown by
            this invitation.
          </p>
          <label>
            Phone name
            <input
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setPending(await startPairing(invitation, name));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Request desktop approval
          </button>
          <button
            onClick={() => {
              setInvitation(null);
              setError("");
            }}
          >
            Choose another computer
          </button>
        </article>
      )}
      {pending && (
        <article role="status">
          <h2>Approve this phone on {invitation?.name}</h2>
          <p>Verify the same phrase appears on both devices:</p>
          <strong className="verification-phrase">{pending.phrase}</strong>
          <p>
            Waiting for approval until{" "}
            {new Date(pending.expiresAt).toLocaleTimeString()}.
          </p>
          <button
            onClick={async () => {
              const current = pending;
              setPending(null);
              setInvitation(null);
              setError("");
              if (invitation) {
                try {
                  await cancelPairing(invitation, current);
                } catch {
                  setError(
                    "Could not confirm cancellation. Deny the request on the desktop, or wait for it to expire.",
                  );
                }
              }
            }}
          >
            Cancel on this phone
          </button>
        </article>
      )}
      {busy && <p role="status">Connecting securely…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        Remembered computers reconnect without scanning again. Each phone has
        its own approval; the desktop can revoke it independently.
      </p>
      <button onClick={onLegacy}>Legacy shared-key connection</button>
    </section>
  );
}
