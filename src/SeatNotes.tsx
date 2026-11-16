import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Modal } from "./components";
import {
  MAX_NOTE_CHARS,
  countNoteChars,
  noteFor,
  noteKey,
  notePreview,
  orphanSeatNotes,
  type SeatNotes,
} from "./seat-notes";
import type { Seat } from "./types";

/**
 * A seat row's private note: a Notes button and, once it is opened, a dialog
 * with a text box. Edits stay in the dialog until Save. Nothing is sent to the
 * seat, its session or any host, and the text is drawn only as React text.
 */
export default function SeatNote({
  seat,
  connectionId,
  notes,
  onNote,
}: {
  seat: Seat;
  connectionId: string;
  notes: SeatNotes | undefined;
  onNote: (seat: Seat, text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const key = noteKey(connectionId, seat.id);
  if (!key) return null;
  const saved = noteFor(notes, key);
  const used = countNoteChars(draft);
  const label = "Notes for " + seat.name;
  const close = () => setOpen(false);
  return (
    <>
      <button
        className={"icon-button seat-note" + (saved ? " has-note" : "")}
        title={saved ? label + ": " + notePreview(saved) : label}
        aria-label={saved ? label + " (has a note)" : label}
        onClick={() => {
          setDraft(saved);
          setOpen(true);
        }}
      >
        <StickyNote size={13} />
      </button>
      {open && (
        <Modal
          title={"Note for " + seat.name}
          subtitle="Private to you. Saved on this computer only. Do not store secrets here. It is never sent to the seat, a terminal or anywhere else."
          onClose={close}
        >
          <textarea
            aria-label="Seat note"
            aria-describedby="seat-note-count"
            rows={8}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="field-note" id="seat-note-count">
            {used +
              " / " +
              MAX_NOTE_CHARS +
              " characters" +
              (used > MAX_NOTE_CHARS
                ? ". Only the first " + MAX_NOTE_CHARS + " are kept."
                : "")}
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={!saved}
              onClick={() => {
                onNote(seat, "");
                close();
              }}
            >
              Clear
            </button>
            <button className="secondary-button" onClick={close}>
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={() => {
                onNote(seat, draft);
                close();
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Lists and explicitly removes notes for seats absent from this connection's verified live inventory. */
export function OrphanSeatNotesManager({
  connectionId,
  connectionName,
  notes,
  liveSeatIds,
  available,
  onDelete,
}: {
  connectionId: string;
  connectionName: string;
  notes: SeatNotes | undefined;
  liveSeatIds: readonly string[];
  available: boolean;
  onDelete: (keys: readonly string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<readonly string[] | null>(null);
  const orphans = available ? orphanSeatNotes(notes, connectionId, liveSeatIds) : [];
  const bulkDeleteAvailable = available && liveSeatIds.length > 0;
  const pending = pendingKeys?.filter((key) => orphans.some((row) => row.key === key)) || [];
  const title = "Manage notes for removed seats";
  return (
    <>
      <button
        type="button"
        className="small-button orphan-notes-button"
        aria-label={`${title} (${orphans.length})`}
        title={available ? title : "Refresh this connection's inventory to manage orphan notes"}
        disabled={!available}
        onClick={() => setOpen(true)}
      >
        <StickyNote size={13} aria-hidden="true" /> Notes <span className="count">{orphans.length}</span>
      </button>
      {open && !pendingKeys && (
        <Modal
          title={title}
          subtitle={`Only notes for ${connectionName} are checked. A verified current inventory is required; notes for live seats are never listed.`}
          onClose={() => setOpen(false)}
          wide
        >
          {orphans.length ? (
            <>
              <ul className="orphan-notes-list">
                {orphans.map((note) => (
                  <li key={note.key}>
                    <div>
                      <code>{note.seatId}</code>
                      <span>{note.preview || "(empty note)"}</span>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`Delete note for ${note.seatId}`}
                      onClick={() => setPendingKeys([note.key])}
                    >
                      Delete...
                    </button>
                  </li>
                ))}
              </ul>
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setOpen(false)}>Close</button>
                <button className="secondary-button" aria-label="Delete all orphan notes" disabled={!bulkDeleteAvailable}
                  title={bulkDeleteAvailable ? undefined : "At least one verified live seat is required for bulk deletion"}
                  onClick={() => setPendingKeys(orphans.map((row) => row.key))}>
                  Delete all {orphans.length} orphan notes...
                </button>
              </div>
              {!bulkDeleteAvailable && (
                <p className="muted">Delete all is disabled because this inventory contains no live seats. Verify at least one seat before bulk deletion; you can still review and delete one note at a time.</p>
              )}
            </>
          ) : (
            <>
              <p>No orphan notes for this connection.</p>
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setOpen(false)}>Close</button>
              </div>
            </>
          )}
        </Modal>
      )}
      {open && pendingKeys && (
        <Modal
          title="Confirm note deletion"
          subtitle={pending.length
            ? `Delete ${pending.length === 1 ? "this note" : `these ${pending.length} notes`} for seats no longer present in ${connectionName}'s verified inventory? This cannot be undone.`
            : "These notes are no longer orphaned in the current inventory. Nothing will be deleted."}
          onClose={() => setPendingKeys(null)}
        >
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setPendingKeys(null)}>Cancel</button>
            <button
              className="primary-button"
              aria-label="Confirm deletion of orphan notes"
              disabled={!pending.length || !available}
              onClick={() => {
                if (pending.length && available) onDelete(pending);
                setPendingKeys(null);
                setOpen(false);
              }}
            >
              Delete {pending.length || "none"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
