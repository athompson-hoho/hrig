import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal } from "./components";
import type { Connection, Seat } from "./types";

type Snapshot = { text: string; truncated: boolean; capturedAt: string };

/** Read-only snapshot of what a needs-input seat is showing. Sends nothing to the seat. */
export default function SeatTranscript({
  connection,
  seat,
  onClose,
}: {
  connection: Connection;
  seat: Seat;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setCopied(false);
    window.hrig
      .seatTranscript(connection, seat.id)
      .then((result) => { if (active) setSnapshot(result); })
      .catch((e) => { if (active) { setSnapshot(null); setError((e as Error).message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [connection, seat.id, revision]);
  const copy = useCallback(() => {
    if (!snapshot) return;
    navigator.clipboard?.writeText(snapshot.text).then(() => setCopied(true), () => setCopied(false));
  }, [snapshot]);
  return (
    <Modal
      title="Transcript tail"
      subtitle={`${seat.name} in ${seat.rigName} · read-only`}
      onClose={onClose}
      wide
    >
      <div className="editor-notice">
        The most recent lines OpenRig recorded for this session, read once when
        opened. It is not live, may lag the terminal, and nothing is sent to the
        session. It may include private text.
      </div>
      {loading && <p role="status">Reading the recorded transcript...</p>}
      {error && <ErrorBox error={error} />}
      {snapshot && !loading && (
        <>
          <pre className="seat-prompt-text seat-transcript-text" tabIndex={0} aria-label="Transcript tail text">
            {snapshot.text || "No transcript text is recorded for this session."}
          </pre>
          <p role="status">
            Captured {new Date(snapshot.capturedAt).toLocaleTimeString()}
            {snapshot.truncated ? " · showing only the most recent lines" : ""}
            {copied ? " · Copied" : ""}
          </p>
        </>
      )}
      <div className="modal-actions">
        <button className="secondary-button" onClick={() => setRevision((n) => n + 1)} disabled={loading}>
          Refresh transcript
        </button>
        <button className="secondary-button" onClick={copy} disabled={!snapshot || !snapshot.text}>
          Copy text
        </button>
        <button className="primary-button" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
