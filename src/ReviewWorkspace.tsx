import { useEffect, useState } from "react";
import { GitBranch, Send, FileCode2, AlertCircle } from "lucide-react";
import type { Connection, Seat, GitEntry } from "./types";
import { ErrorBox, Loading } from "./components";
import { problems } from "./editor-buffers";
const reviewDrafts = new Map<
  string,
  {
    target: string;
    path: string;
    line: string;
    text: string;
    notes: { path: string; line: string; text: string }[];
  }
>();
export function ReviewWorkspace({
  connection,
  root,
  seats,
  onDiff,
  onSeat,
}: {
  connection: Connection;
  root: string;
  seats: Seat[];
  onDiff: (path: string) => void;
  onSeat: (seat: Seat) => void;
}) {
  const [changes, setChanges] = useState<GitEntry[] | null>(null);
  const draftKey = connection.id + "::" + root;
  const [target, setTarget] = useState(
    reviewDrafts.get(draftKey)?.target || "",
  );
  const [path, setPath] = useState(reviewDrafts.get(draftKey)?.path || "");
  const [line, setLine] = useState(reviewDrafts.get(draftKey)?.line || "");
  const [text, setText] = useState(reviewDrafts.get(draftKey)?.text || "");
  const [notes, setNotes] = useState<
    { path: string; line: string; text: string }[]
  >(reviewDrafts.get(draftKey)?.notes || []);
  useEffect(() => {
    reviewDrafts.set(draftKey, { target, path, line, text, notes });
  }, [draftKey, target, path, line, text, notes]);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    window.hrig
      .git(connection, root)
      .then((r) => {
        if (active) setChanges(r);
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
      {error && <ErrorBox error={error} />}
      <label className="field-label">
        FEEDBACK RECIPIENT
        <select
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
        {changes === null ? (
          <Loading />
        ) : changes.length ? (
          changes.map((c) => (
            <button
              key={c.path}
              onClick={() => {
                reviewDrafts.set(draftKey, {
                  target,
                  path: c.path,
                  line,
                  text,
                  notes,
                });
                setPath(c.path);
                onDiff(c.path);
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
            aria-label="Review note line"
            value={line}
            onChange={(e) => setLine(e.target.value)}
          />
        </label>
      </div>
      <textarea
        aria-label="Review note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Explain the concern or requested change…"
        rows={4}
      />
      <div className="arrange-controls">
        <button
          className="secondary-button"
          disabled={!path || !text.trim()}
          onClick={() => {
            setNotes((n) => [...n, { path, line, text }]);
            setText("");
            setSent(false);
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
          <button
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
        disabled={busy || !seat || !notes.length}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await window.hrig.sendMessage(
              connection,
              seat!.name + "@" + seat!.rigName,
              "Review feedback for project " +
                root +
                "\n\n" +
                notes
                  .map(
                    (n) =>
                      n.path + (n.line ? ":" + n.line : "") + "\n" + n.text,
                  )
                  .join("\n\n"),
            );
            setSent(true);
            setNotes([]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Send size={14} />
        {busy ? "Sending…" : "Send notes to selected seat"}
      </button>
      {sent && <p className="success-note">Feedback sent through OpenRig.</p>}
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
