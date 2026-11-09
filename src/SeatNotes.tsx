import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Modal } from "./components";
import {
  MAX_NOTE_CHARS,
  countNoteChars,
  noteFor,
  noteKey,
  notePreview,
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
