import { useEffect, useState } from "react";
import { GitBranch, Send, FileCode2, AlertCircle } from "lucide-react";
import type { Connection, Seat, GitEntry } from "./types";
import { ErrorBox, Loading } from "./components";
import { problems } from "./editor-buffers";
import { draftKey, draftOperation, useDraft } from "./drafts";
export function ReviewWorkspace({
  connection,
  root,
  seats,
  onDiff,
  onSeat,
  onProject,
}: {
  connection: Connection;
  root: string;
  seats: Seat[];
  onDiff: (path: string) => void;
  onSeat: (seat: Seat) => void;
  onProject: () => void;
}) {
  const [changes, setChanges] = useState<GitEntry[] | null>(null);
  const [isRepository, setIsRepository] = useState(true);
  const key = draftKey("review", connection, root);
  type Note = {
    path: string;
    line: string;
    text: string;
    revision: string;
    recipient: string;
  };
  const [draft, setDraft, storageError] = useDraft(
    key,
    "review",
    {
      target: "",
      path: "",
      line: "",
      text: "",
      notes: [] as Note[],
      status: "draft",
      anchorPath: "",
      anchorRevision: "",
    },
    { connection, root },
  );
  const { target, path, line, text, notes } = draft;
  const setTarget = (v: string) =>
    setDraft((d) => ({ ...d, target: v, status: "draft" }));
  const setPath = (v: string) =>
    setDraft((d) => ({ ...d, path: v, status: "draft" }));
  const setLine = (v: string) =>
    setDraft((d) => ({ ...d, line: v, status: "draft" }));
  const setText = (v: string) =>
    setDraft((d) => ({ ...d, text: v, status: "draft" }));
  const setNotes = (v: Note[] | ((n: Note[]) => Note[])) =>
    setDraft((d) => ({
      ...d,
      notes: typeof v === "function" ? v(d.notes) : v,
      status: "draft",
    }));
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setChanges(null);
    setIsRepository(true);
    setError("");
    window.hrig
      .git(connection, root)
      .then((r) => {
        if (active) {
          setChanges(r.entries);
          setIsRepository(r.isRepository);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [connection.id, root, revision]);
  const seat = seats.find((s) => s.id === (target || seats[0]?.id));
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <GitBranch />
        <div>
          <h3>Review workspace</h3>
          <p>
            {root} · These are project changes; HRig does not assume an agent
            authored them.
          </p>
        </div>
        <button
          className="small-button"
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh changes
        </button>
      </div>
      {(error || storageError) && <ErrorBox error={error || storageError} />}
      <label className="field-label">
        FEEDBACK RECIPIENT
        <select
          disabled={busy}
          aria-label="Review recipient"
          value={target || seats[0]?.id || ""}
          onChange={(e) => {
            setTarget(e.target.value);
            setSent(false);
          }}
        >
          {seats.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}@{s.rigName}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary-button"
        disabled={!seat}
        onClick={() => seat && onSeat(seat)}
      >
        Open recipient session
      </button>
      <div className="review-changes">
        {!isRepository ? (
          <div className="sidebar-empty">
            <GitBranch size={25} />
            <strong>Open a Git project</strong>
            <p>
              This folder is not a Git repository. Choose your repository folder
              to review changes.
            </p>
            <button className="secondary-button" onClick={onProject}>
              Choose project folder
            </button>
          </div>
        ) : changes === null && !error ? (
          <Loading />
        ) : error && changes === null ? null : changes?.length ? (
          changes.map((c) => (
            <button
              key={c.path}
              onClick={async () => {
                try {
                  const file = await window.hrig.edit(connection, {
                    op: "read",
                    root,
                    path: c.path,
                  });
                  setDraft((d) => ({
                    ...d,
                    path: c.path,
                    anchorPath: c.path,
                    anchorRevision: file.revision,
                  }));
                  onDiff(c.path);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <FileCode2 size={14} />
              <span>{c.path}</span>
              <small>{c.status}</small>
            </button>
          ))
        ) : (
          <p className="field-note">The working tree is clean.</p>
        )}
      </div>
      <h3 className="section-heading">Review notes</h3>
      <div className="form-grid">
        <label className="field-label">
          FILE
          <input
            disabled={busy}
            aria-label="Review note file"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <label className="field-label">
          LINE (OPTIONAL)
          <input
            type="number"
            min="1"
            disabled={busy}
            aria-label="Review note line"
            value={line}
            onChange={(e) => setLine(e.target.value)}
          />
        </label>
      </div>
      <textarea
        disabled={busy}
        aria-label="Review note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Explain the concern or requested change…"
        rows={4}
      />
      <div className="arrange-controls">
        <button
          className="secondary-button"
          disabled={busy || !seat || !path || !text.trim() || !!storageError}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const file = await window.hrig.edit(connection, {
                op: "read",
                root,
                path,
              });
              if (
                draft.anchorPath === path &&
                draft.anchorRevision &&
                draft.anchorRevision !== file.revision
              )
                throw new Error(
                  "The reviewed file changed. Open the diff again before adding this note.",
                );
              setNotes((n) => [
                ...n,
                {
                  path,
                  line,
                  text,
                  revision: file.revision,
                  recipient: JSON.stringify([
                    seat!.rigId,
                    seat!.rigName,
                    seat!.id,
                    seat!.name,
                  ]),
                },
              ]);
              setText("");
              setSent(false);
            } catch (e) {
              setError("Cannot anchor review note: " + (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Add review note
        </button>
      </div>
      {notes.map((n, i) => (
        <div className="review-note" key={i}>
          <strong>
            {n.path}
            {n.line ? ":" + n.line : ""}
          </strong>
          <p>{n.text}</p>
          <small className="field-note">
            Revision: {n.revision.slice(0, 12)}
          </small>
          <button
            disabled={busy}
            onClick={() =>
              setNotes((old) => old.filter((_, index) => index !== i))
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="primary-button"
        disabled={busy || !seat || !notes.length || !!storageError}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            for (const note of notes) {
              if (
                note.recipient !==
                JSON.stringify([
                  seat!.rigId,
                  seat!.rigName,
                  seat!.id,
                  seat!.name,
                ])
              )
                throw new Error(
                  "These notes belong to another recipient. Select their original seat.",
                );
              const current = await window.hrig.edit(connection, {
                op: "read",
                root,
                path: note.path,
              });
              if (current.revision !== note.revision)
                throw new Error(
                  "Stale review note: " +
                    note.path +
                    " changed. Remove and re-add the note after reviewing the latest diff.",
                );
            }
            const pending = { ...draft, status: "sending" };
            draftOperation("put", key, {
              kind: "review",
              connection,
              root,
              data: pending,
            });
            setDraft(pending);
            await window.hrig.sendMessage(
              connection,
              seat!.name + "@" + seat!.rigName,
              "Review feedback for project " +
                root +
                "\n\n" +
                notes
                  .map(
                    (n) =>
                      n.path +
                      (n.line ? ":" + n.line : "") +
                      "\nRevision: " +
                      n.revision +
                      "\n" +
                      n.text,
                  )
                  .join("\n\n"),
            );
            setSent(true);
            setDraft((d) => ({ ...d, notes: [], status: "accepted" }));
          } catch (e) {
            setError((e as Error).message);
            setDraft((d) => ({
              ...d,
              status: d.status === "sending" ? "unknown" : d.status,
            }));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Send size={14} />
        {busy ? "Sending…" : "Send notes to selected seat"}
      </button>
      {draft.status === "accepted" && (
        <p className="success-note">
          Feedback accepted by OpenRig. Accepted does not confirm the agent
          read it.
        </p>
      )}
      {["sending", "unknown"].includes(draft.status) && !busy && (
        <p className="editor-notice" role="status">
          Delivery may be uncertain. Notes are preserved; check the recipient
          before sending again. No automatic retries.
        </p>
      )}
    </div>
  );
}
export function ProblemsPanel({
  onFile,
}: {
  onFile: (
    connection: Connection,
    root: string,
    path: string,
    line: number,
  ) => void;
}) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = () => refresh((n) => n + 1);
    window.addEventListener("hrig:problems", listener);
    return () => window.removeEventListener("hrig:problems", listener);
  }, []);
  const markers = [...problems.values()].flat();
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <AlertCircle />
        <div>
          <h3>Problems</h3>
          <p>
            Diagnostics from opened files. Built-in Monaco language support; not
            a remote language server.
          </p>
        </div>
      </div>
      {!markers.length ? (
        <p className="field-note">
          No diagnostics reported by the opened editors.
        </p>
      ) : (
        markers.map((m, i) => (
          <button
            className="problem-row"
            key={i}
            onClick={() => onFile(m.connection, m.root, m.path, m.line)}
          >
            <span>{m.severity >= 8 ? "Error" : "Warning"}</span>
            <section>
              <strong>
                {m.path}:{m.line}
              </strong>
              <p>{m.message}</p>
            </section>
          </button>
        ))
      )}
    </div>
  );
}
