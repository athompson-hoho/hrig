import { useState } from "react";
import { draftOperation } from "./drafts";
import { ErrorBox } from "./components";
import type { PanelConfig } from "./types";
export default function SavedDrafts({
  onOpen,
}: {
  onOpen: (config: PanelConfig) => void;
}) {
  const [revision, refresh] = useState(0),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  let entries: [string, any][] = [];
  try {
    entries = Object.entries(draftOperation("list")).filter(
      ([, draft]: [string, any]) => draft.kind !== "board",
    );
  } catch (e) {
    if (!error) queueMicrotask(() => setError((e as Error).message));
  }
  const remove = (key?: string) => {
    try {
      draftOperation(key ? "delete" : "clear", key);
      window.dispatchEvent(new Event('hrig:drafts-cleared'));
      refresh(revision + 1);
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="tool-panel">
      <h3>Saved drafts</h3>
      <p className="field-note">
        Recovery copies and message/review drafts are stored locally in HRig's
        data folder. They may contain sensitive text. Storage is limited to 100
        drafts / 20 MB; clearing drafts does not change project files. Active
        editors/composers can create new copies as you edit.
      </p>
      {error && <ErrorBox error={error} />}
      {!entries.length && <p>No saved drafts.</p>}
      {entries.map(([key, draft]) => (
        <div className="review-note" key={key}>
          <strong>
            {draft.kind}:{" "}
            {draft.config?.path ||
              draft.root ||
              draft.connection?.name ||
              "Draft"}
          </strong>
          <p className="field-note">
            {draft.config?.connection?.name || draft.connection?.name} ·{" "}
            {draft.updatedAt}
          </p>
          {draft.kind === "editor" && (
            <button
              className="small-button"
              onClick={() => onOpen(draft.config)}
            >
              Open recovery file
            </button>
          )}
          <button className="small-button" onClick={() => remove(key)}>
            Delete saved copy
          </button>
        </div>
      ))}
      {entries.length > 0 && (
        <button className="secondary-button" onClick={() => setConfirm(true)}>
          Clear all saved drafts
        </button>
      )}
      {confirm && (
        <div className="external-change">
          <span>
            Delete all local recovery copies and saved message/review drafts?
          </span>
          <button onClick={() => remove()}>Confirm clear drafts</button>
          <button onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
