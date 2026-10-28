import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { ErrorBox, Modal } from "./components";
import type { Connection, Seat } from "./types";
export default function RelaunchSession({
  connection,
  seat,
  onClose,
  onDone,
}: {
  connection: Connection;
  seat: Seat;
  onClose: () => void;
  onDone: () => void;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("Relaunch requested from hRig");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setChecking(true);
    setToken("");
    setError("");
    window.hrig
      .rigAction(connection, { op: "relaunchPlan", id: seat.id })
      .then((result) => {
        if (active) setToken(result.token);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [connection, seat.id, revision]);
  const run = async () => {
    if (busy || !token) return;
    setBusy(true);
    setError("");
    try {
      await window.hrig.rigAction(connection, {
        op: "relaunch",
        id: seat.id,
        token,
        confirmation,
        reason,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setToken("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Relaunch session"
      subtitle="Start a fresh agent in this seat."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="relaunch-target">
        <RotateCw size={20} />
        <div>
          <strong>{seat.name}</strong>
          <p>
            {seat.rigName} / {seat.runtime} / {connection.name}
          </p>
        </div>
      </div>
      <div className="editor-notice">
        This stops the current agent, interrupts any active work, and starts a
        fresh conversation. Conversation context is not resumed. Other seats and
        your workspace arrangement stay in place. To keep the current agent
        running, use Reconnect terminal instead.
      </div>
      {checking && (
        <p role="status">Checking whether OpenRig can relaunch this session...</p>
      )}
      {!checking && token && (
        <p role="status">
          Ready for a fresh relaunch. No agent has been stopped.
        </p>
      )}
      {error && <ErrorBox error={error} />}
      <label className="field-label">
        REASON
        <input
          aria-label="Relaunch reason"
          value={reason}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <label className="field-label">
        TYPE {seat.name} TO CONFIRM
        <input
          aria-label="Confirm session name"
          autoComplete="off"
          value={confirmation}
          disabled={busy}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      <div className="modal-actions">
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        {!checking && !token && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => setRevision((n) => n + 1)}
          >
            Check again
          </button>
        )}
        <button
          className="primary-button"
          disabled={
            busy ||
            checking ||
            !token ||
            confirmation !== seat.name ||
            !reason.trim()
          }
          onClick={run}
        >
          <RotateCw size={14} />
          {busy ? "Relaunching..." : "Relaunch fresh session"}
        </button>
      </div>
    </Modal>
  );
}
