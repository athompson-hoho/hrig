import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal } from "./components";
import type { Connection, Seat } from "./types";
import { compareCandidates, compareLabel, snapshotStats } from "./seat-compare";

type Snapshot = { text: string; truncated: boolean; capturedAt: string };

function useSnapshot(connection: Connection, seatId: string | null, revision: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!seatId);
  useEffect(() => {
    if (!seatId) {
      setSnapshot(null);
      setError("");
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    setSnapshot(null);
    window.hrig
      .seatTranscript(connection, seatId)
      .then((result) => { if (active) setSnapshot(result); })
      .catch((e) => { if (active) { setSnapshot(null); setError((e as Error).message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [connection, seatId, revision]);
  return { snapshot, error, loading };
}

function Pane({ title, state, label, seat }: { title: string; state: ReturnType<typeof useSnapshot>; label: string; seat?: Seat }) {
  const { snapshot, error, loading } = state;
  const stats = snapshot ? snapshotStats(snapshot.text) : null;
  return (
    <section className="seat-compare-pane" aria-label={label}>
      <h4>{title}</h4>
      {seat && (
        <p className="subtle">
          Now: {seat.status}{seat.activity ? ` · ${seat.activity}` : ""}{typeof seat.workCount === "number" ? ` · ${seat.workCount} work item${seat.workCount === 1 ? "" : "s"}` : ""}
        </p>
      )}
      {loading && <p role="status">Reading the recorded transcript...</p>}
      {error && <ErrorBox error={error} />}
      {snapshot && !loading && (
        <>
          <pre className="seat-prompt-text seat-transcript-text" tabIndex={0} aria-label={`${label} text`}>
            {snapshot.text || "No transcript text is recorded for this session."}
          </pre>
          <p role="status">
            Captured {new Date(snapshot.capturedAt).toLocaleTimeString()} · {stats!.lines} lines
            {snapshot.truncated ? " · showing only the most recent lines" : ""}
          </p>
        </>
      )}
    </section>
  );
}

/** Read-only snapshot of what a needs-input seat is showing. Sends nothing to the seat. */
export default function SeatTranscript({
  connection,
  seat,
  others = [],
  onClose,
}: {
  connection: Connection;
  seat: Seat;
  /** Other seats of the same connection that can be compared side by side. */
  others?: Seat[];
  onClose: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const [otherId, setOtherId] = useState("");
  const candidates = compareCandidates(others, seat);
  const other = candidates.find((c) => c.id === otherId) || null;
  const first = useSnapshot(connection, seat.id, revision);
  const second = useSnapshot(connection, other ? other.id : null, revision);
  useEffect(() => setCopied(false), [revision, seat.id, otherId]);
  const copy = useCallback(() => {
    if (!first.snapshot) return;
    const text = other && second.snapshot
      ? `=== ${seat.name} (${seat.rigName}) ===\n${first.snapshot.text}\n\n=== ${other.name} (${other.rigName}) ===\n${second.snapshot.text}`
      : first.snapshot.text;
    navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  }, [first.snapshot, second.snapshot, other, seat]);
  const loading = first.loading || second.loading;
  return (
    <Modal
      title={other ? "Compare recent activity" : "Transcript tail"}
      subtitle={other ? `${seat.name} and ${other.name} · read-only` : `${seat.name} in ${seat.rigName} · read-only`}
      onClose={onClose}
      wide
    >
      <div className="editor-notice">
        The most recent lines OpenRig recorded for {other ? "these sessions" : "this session"}, read once when
        opened. It is not live, may lag the terminal, and nothing is sent to any
        session. It may include private text.
      </div>
      {candidates.length > 0 && (
        <label className="field-label">
          COMPARE WITH
          <select aria-label="Compare with another session" value={other ? other.id : ""} onChange={(e) => setOtherId(e.target.value)}>
            <option value="">No comparison</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{compareLabel(c)}</option>)}
          </select>
        </label>
      )}
      <div className={other ? "seat-compare-grid two" : "seat-compare-grid"}>
        <Pane title={other ? seat.name : ""} state={first} label={other ? `${seat.name} transcript` : "Transcript tail"} seat={other ? seat : undefined} />
        {other && <Pane title={other.name} state={second} label={`${other.name} transcript`} seat={other} />}
      </div>
      {copied && <p role="status">Copied</p>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={() => setRevision((n) => n + 1)} disabled={loading}>
          Refresh transcript
        </button>
        <button className="secondary-button" onClick={copy} disabled={!first.snapshot || !first.snapshot.text}>
          {other ? "Copy both" : "Copy text"}
        </button>
        <button className="primary-button" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
