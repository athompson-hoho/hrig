import { useEffect, useRef } from "react";
import { Modal } from "./components";
import { previewOf } from "./terminal-paste-history";

export default function TerminalPasteHistory({
  entries,
  onChoose,
  onClear,
  onClose,
}: {
  entries: readonly string[];
  onChoose: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Child effects run before parent effects, so this runs after Modal's own
  // focus effect (which would pick the Close icon): focus starts on the list
  // itself, nothing is chosen, and Enter straight away pastes nothing.
  useEffect(() => list.current?.focus(), []);
  return (
    <Modal
      title="Paste from history"
      subtitle="Nothing is sent to the terminal until you choose an entry."
      onClose={onClose}
    >
      {/* Modal's Escape listener lives on the main window only; a popped-out panel needs its own. */}
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <p className="field-note">
          Text you pasted into this terminal with HRig, newest first. It is kept
          in memory only, never saved or sent anywhere, and can contain secrets.
          Choosing an entry pastes it like a normal paste and never presses
          Enter.
        </p>
        <div
          ref={list}
          tabIndex={-1}
          role="group"
          aria-label="Recent pastes"
          className="dropdown"
          style={{ position: "static", overflowWrap: "anywhere" }}
        >
          {entries.map((text, index) => {
            const preview = previewOf(text);
            const lines = preview.lines === 1 ? "line" : "lines";
            return (
              <button key={index} onClick={() => onChoose(text)}>
                <span>
                  {preview.text || "(no visible text)"}
                  <small>{`${preview.lines} ${lines}, ${preview.chars} characters`}</small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="secondary-button danger" onClick={onClear}>
            Clear history
          </button>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
