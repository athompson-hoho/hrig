import { useEffect, useMemo, useRef, useState } from "react";
import type { Connection } from "./types";
import { fileReferences, type FileReference } from "./file-references";
import { pickTaskBody } from "./markdown-safe";

// The most of an error message that is shown.
const MAX_NOTICE = 200;

const whyFailed = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, MAX_NOTICE);

/** The files the text of a task mentions, as buttons under the task's text. A click reads the file with the same check as a path in a terminal and then opens it in the editor at the line; a file that cannot be read shows why and nothing opens. Nothing opens by itself, nothing is sent, and every string reaches the page as React text. A task that mentions no file renders nothing. */
export default function TaskFileReferences({
  detail,
  connection,
  root,
  onFile,
}: {
  detail: unknown;
  connection: Connection;
  root: string;
  onFile: (path: string, line?: number) => void;
}) {
  const refs = useMemo(() => {
    const picked = pickTaskBody(detail);
    return picked ? fileReferences(picked.text, root) : [];
  }, [detail, root]);
  const [notice, setNotice] = useState("");
  // A read that finishes after the dialog was closed opens nothing.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (!refs.length) return null;
  const open = (ref: FileReference) => {
    setNotice("");
    window.hrig
      .edit(connection, { op: "read", root, path: ref.path })
      .then(() => {
        if (alive.current) onFile(ref.path, ref.line);
      })
      .catch((e) => {
        if (alive.current)
          setNotice("Could not open " + ref.label + ": " + whyFailed(e));
      });
  };
  return (
    <>
      <div className="field-label" role="group" aria-label="Files mentioned">
        FILES MENTIONED
        <div className="task-file-refs">
          {refs.map((ref) => (
            <button
              key={ref.path + ":" + (ref.line ?? "")}
              className="small-button"
              title={ref.path}
              onClick={() => open(ref)}
            >
              {ref.label}
            </button>
          ))}
        </div>
      </div>
      {notice && (
        <p className="field-note" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
