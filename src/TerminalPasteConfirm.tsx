import { useEffect, useRef } from "react";
import { Modal } from "./components";

export default function TerminalPasteConfirm({
  lines,
  preview,
  endsWithBreak,
  onAnswer,
}: {
  lines: number;
  preview: string;
  endsWithBreak: boolean;
  onAnswer: (ok: boolean) => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  // Child effects run before parent effects, so this runs after Modal's own
  // focus effect (which would pick the Close icon): Enter straight away cancels.
  useEffect(() => cancel.current?.focus(), []);
  return (
    <Modal
      title={`Paste ${lines} ${lines === 1 ? "line" : "lines"}?`}
      subtitle="Nothing is sent to the terminal until you choose Paste."
      onClose={() => onAnswer(false)}
    >
      {/* Modal's Escape listener lives on the main window only; a popped-out panel needs its own. */}
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onAnswer(false);
          }
        }}
      >
        <pre className="json-result" aria-label="Text to paste">
          {preview}
        </pre>
        {endsWithBreak && (
          <div className="external-change" role="status">
            <span>Ends with a line break: it will run immediately</span>
          </div>
        )}
        <div className="modal-actions">
          <button
            ref={cancel}
            className="secondary-button"
            onClick={() => onAnswer(false)}
          >
            Cancel
          </button>
          <button className="primary-button" onClick={() => onAnswer(true)}>
            Paste
          </button>
        </div>
      </div>
    </Modal>
  );
}
