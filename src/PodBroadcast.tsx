import { useMemo, useState } from "react";
import { AlertTriangle, Send } from "lucide-react";
import { Modal, ErrorBox } from "./components";
import {
  MAX_RECIPIENTS,
  MAX_TEXT_CHARS,
  confirmationPhrase,
  confirmed,
  podGroups,
  previewRecipients,
  validateBroadcastText,
} from "./pod-broadcast";
import { runPodBroadcast, type BroadcastResult } from "./pod-broadcast-send";
import type { Connection, Seat } from "./types";

export default function PodBroadcast({
  connection,
  seats,
  inventoryError,
  onClose,
}: {
  connection: Connection;
  seats: Seat[];
  inventoryError: string;
  onClose: () => void;
}) {
  // Freeze the connection and the first preview. A workspace switch cannot silently retarget an open review.
  const [target] = useState(() => ({ connection, seats }));
  const groups = useMemo(() => podGroups(target.seats), [target.seats]);
  const [groupKey, setGroupKey] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<BroadcastResult[]>([]);
  const groupId = (group: (typeof groups)[number]) => JSON.stringify([group.rigId, group.pod]);
  const group = groups.find((candidate) => groupId(candidate) === groupKey) || null;
  const preview = previewRecipients(target.seats, selectedIds);
  const textCheck = validateBroadcastText(text);
  const phrase = confirmationPhrase(preview.recipients.length);
  const canSend = !!group && !busy && !inventoryError && !!phrase &&
    textCheck.ok && confirmed(confirmation, preview.recipients.length);

  const changeGroup = (value: string) => {
    setGroupKey(value);
    setSelectedIds([]);
    setText("");
    setConfirmation("");
    setError("");
    setResults([]);
  };
  const toggle = (id: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? current.includes(id) ? current : [...current, id]
      : current.filter((item) => item !== id));
    setConfirmation("");
    setResults([]);
  };
  const send = async () => {
    if (!group || !canSend) return;
    setBusy(true);
    setError("");
    setResults([]);
    const result = await runPodBroadcast({
      seats: target.seats,
      selectedIds,
      text,
      confirmation,
      readInventory: () => window.hrig.inventory(target.connection),
      sendMessage: (address, body) => window.hrig.sendMessage(target.connection, address, body),
    });
    setBusy(false);
    if (!result.sent) setError(result.error || "Broadcast was not started.");
    setResults(result.results);
  };

  return (
    <Modal
      title="Send a message to a pod"
      subtitle={`${target.connection.name} · preview and confirm each recipient`}
      onClose={() => { if (!busy) onClose(); }}
      wide
    >
      <div className="pod-broadcast-notice">
        <AlertTriangle size={15} />
        <span>This sends a message and presses Enter for each selected seat. It cannot be recalled. Nothing is sent until you choose Send to pod.</span>
      </div>
      {inventoryError && <ErrorBox error={`Inventory is unavailable: ${inventoryError}`} />}
      <label className="field-label">
        POD
        <select aria-label="Choose a pod" value={groupKey} disabled={busy} onChange={(event) => changeGroup(event.target.value)}>
          <option value="">Choose a pod…</option>
          {groups.map((item) => (
            <option key={groupId(item)} value={groupId(item)}>{item.rigName} / {item.pod} ({item.seats.length} seats)</option>
          ))}
        </select>
      </label>
      {target.seats.length > 500 && <p className="pod-broadcast-excluded">Only the first 500 inventory rows are reviewed; rows beyond that limit are not shown or eligible.</p>}
      {group && <>
        <section className="pod-broadcast-section" aria-label="Pod seat selection">
          <h3>Choose recipients</h3>
          <p className="field-note">Select each recipient yourself. Up to {MAX_RECIPIENTS} eligible seats can receive this message.</p>
          <ul className="pod-broadcast-seats">
            {group.seats.map((seat) => (
              <li key={seat.id} className={seat.blocked ? "blocked" : ""}>
                <label>
                  <input type="checkbox" checked={selectedIds.includes(seat.id)} disabled={busy || !!seat.blocked} onChange={(event) => toggle(seat.id, event.target.checked)} />
                  <span>{seat.address}</span>
                  <small>{seat.runtime} · {seat.status}{seat.blocked ? ` · excluded: ${seat.blocked}` : ""}</small>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section className="pod-broadcast-section" aria-label="Recipient preview">
          <h3>Recipient preview ({preview.recipients.length})</h3>
          {preview.recipients.length ? <ol>
            {preview.recipients.map((recipient) => <li key={recipient.id}>{recipient.address} <small>({recipient.runtime} · {recipient.status})</small></li>)}
          </ol> : <p>No eligible recipients selected.</p>}
          {preview.excluded.map((item, index) => <p key={`${item.id}-${index}`} className="pod-broadcast-excluded">Not sent: {item.address || "unknown seat"} · {item.reason}</p>)}
          {preview.unread > 0 && <p className="pod-broadcast-excluded">Not reviewed: {preview.unread} additional selections.</p>}
        </section>
        <label className="field-label">
          EXACT MESSAGE
          <textarea aria-label="Exact message to send" rows={5} maxLength={MAX_TEXT_CHARS * 2} value={text} disabled={busy} onChange={(event) => { setText(event.target.value); setConfirmation(""); setResults([]); }} />
        </label>
        {!textCheck.ok && text.length > 0 && <p className="pod-broadcast-excluded">Message cannot be sent: {textCheck.reason}.</p>}
        <p className="pod-broadcast-exact"><strong>Exact text preview</strong><pre>{textCheck.ok ? textCheck.text : text || "(empty)"}</pre></p>
        <p className="field-note">A message starting with “-” is refused to prevent it being read as a command-line option. The message is not saved in HRig history.</p>
        <label className="field-label">
          TYPE {phrase || "THE RECIPIENT COUNT"} TO CONFIRM
          <input aria-label="Recipient count confirmation" value={confirmation} disabled={busy || !phrase} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
      </>}
      {error && <ErrorBox error={error} />}
      {busy && <p role="status" className="editor-notice">Sending one recipient at a time. This dialog cannot be closed until every result is shown.</p>}
      {results.length > 0 && <section className="pod-broadcast-section" aria-label="Per-seat results" aria-live="polite">
        <h3>Results</h3>
        <ul className="pod-broadcast-results">
          {results.map((result, index) => <li key={`${result.id}-${index}`}>
            <strong>{result.address}</strong> · {result.status}: {result.reason}
          </li>)}
        </ul>
      </section>}
      <div className="modal-actions">
        <button className="secondary-button" disabled={busy} onClick={onClose}>Close</button>
        <button className="primary-button" disabled={!canSend} onClick={() => void send()}><Send size={14} />{busy ? "Sending…" : "Send to pod"}</button>
      </div>
    </Modal>
  );
}
