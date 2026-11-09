import { useState } from "react";
import { ErrorBox, Modal } from "./components";
import type { Connection, Seat } from "./types";

type Review = {
  token: string;
  seatName: string;
  rigName: string;
  session: string;
  payload: string;
  length: number;
  expiresInSeconds: number;
};
const MAX = 4000;

/** Reviewed one-seat message: compose, review recipient and exact payload, then explicitly send. */
export default function SeatMessage({
  connection,
  seat,
  onClose,
  onSent,
}: {
  connection: Connection;
  seat: Seat;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const prepare = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setReview(await window.hrig.seatMessage(connection, { op: "prepare", id: seat.id, message: text }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (busy || !review) return;
    setBusy(true);
    setError("");
    try {
      await window.hrig.seatMessage(connection, { op: "send", id: seat.id, token: review.token });
      onSent(`Message sent to ${review.session}.`);
    } catch (e) {
      // Never retried automatically: the person must review again.
      setError((e as Error).message + " Nothing was retried.");
      setReview(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Quick message"
      subtitle={`${seat.name} in ${seat.rigName} · ${connection.name}`}
      onClose={() => { if (!busy) onClose(); }}
      wide
    >
      {!review ? (
        <>
          <div className="editor-notice">
            Nothing is sent until you review the recipient and exact text and
            choose Send. Messages are typed into the session's terminal with an OpenRig message
            envelope, followed by Enter.
          </div>
          <label className="field-label">
            MESSAGE
            <textarea
              aria-label="Quick message text"
              value={text}
              rows={5}
              maxLength={MAX}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p>{text.length} / {MAX}</p>
          {error && <ErrorBox error={error} />}
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button" onClick={prepare} disabled={busy || !text.trim()}>
              Review message
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            <strong>Recipient:</strong> {review.session} ({review.seatName} in {review.rigName})
          </p>
          <p><strong>Exact text ({review.length} characters):</strong></p>
          <pre className="seat-prompt-text" tabIndex={0} aria-label="Exact message to send">
            {review.payload}
          </pre>
          <p role="status">
            Not sent yet. This review expires in {review.expiresInSeconds} seconds. Sending adds OpenRig's
            From/To message envelope, types the text into the session, and
            presses Enter. On a shell session the text runs as commands. It
            cannot be undone.
          </p>
          {error && <ErrorBox error={error} />}
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => { setReview(null); setError(""); }} disabled={busy}>Edit</button>
            <button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button" onClick={send} disabled={busy}>
              Send to {review.session}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
