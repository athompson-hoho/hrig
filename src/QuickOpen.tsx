import { useEffect, useRef, useState } from "react";
import { FileCode2, Search, ArrowUpRight } from "lucide-react";
import { ErrorBox, Modal } from "./components";
import type { Connection, FileEntry } from "./types";
interface Results {
  files: (FileEntry & { score: number })[];
  matches: number;
  scannedFiles: number;
  scannedEntries: number;
  partial: boolean;
  limited: boolean;
}
export default function QuickOpen({
  connection,
  root,
  onOpen,
  onClose,
}: {
  connection: Connection;
  root: string;
  onOpen: (path: string, line?: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0),
    [results, setResults] = useState<Results | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  // Enter pressed while a refinement is in flight opens the fresh top match,
  // never a row from the superseded list.
  const openWhenReady = useRef(false);
  const requests = useRef<Promise<void>>(Promise.resolve());
  const suffix = query.match(/:(\d+)$/);
  const term = suffix ? query.slice(0, -suffix[0].length) : query;
  const line = suffix
    ? Math.min(10000000, Math.max(1, Number(suffix[1])))
    : undefined;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    openWhenReady.current = false;
    const timer = setTimeout(() => {
      requests.current = requests.current
        .catch(() => {})
        .then(async () => {
          if (!active) return;
          try {
            const value = await window.hrig.file(connection, {
              op: "quickOpen",
              root,
              query: term,
            });
            if (active) {
              setResults(value);
              setSelected(0);
              if (openWhenReady.current) {
                openWhenReady.current = false;
                const first = value.files[0];
                if (first) onOpen(first.path, lineRef.current);
              }
            }
          } catch (e) {
            if (active) {
              setResults(null);
              setError((e as Error).message);
            }
          } finally {
            if (active) setBusy(false);
          }
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    term,
    connection.id,
    connection.kind,
    connection.host,
    connection.port,
    connection.distro,
    root,
  ]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const lineRef = useRef(line);
  lineRef.current = line;
  const choose = (index: number, fromKeyboard = false) => {
    if (busy && fromKeyboard) {
      openWhenReady.current = true;
      return;
    }
    const file = results?.files[index];
    if (file) onOpen(file.path, line);
  };
  return (
    <Modal
      title="Quick Open"
      subtitle={`${connection.name} · ${root}`}
      onClose={onClose}
      wide
    >
      <label className="navigation-search">
        <Search size={17} />
        <input
          aria-label="Quick Open file search"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          placeholder="Type a fuzzy path… add :line to jump"
          maxLength={300}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-controls="quick-open-results"
          aria-activedescendant={
            results?.files.length ? "quick-file-" + selected : undefined
          }
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const count = results?.files.length || 0;
              if (count)
                setSelected(
                  (i) => (i + (e.key === "ArrowDown" ? 1 : -1) + count) % count,
                );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(selected, true);
            }
          }}
        />
        <kbd>{window.hrig.platform === "darwin" ? "Cmd P" : "Ctrl P"}</kbd>
      </label>
      {error && <ErrorBox error={error} />}
      <div className="navigation-status" role="status">
        {busy
          ? "Searching project files…"
          : results
            ? `${results.files.length} shown · ${results.matches} matches · ${results.scannedFiles} files scanned${results.partial ? " · Partial scan: some folders were skipped or the scan limit was reached." : ""}${results.limited ? " · Best 100 matches shown." : ""}`
            : ""}
      </div>
      <div
        ref={list}
        id="quick-open-results"
        className="navigation-results"
        aria-busy={busy}
        style={busy && results ? { opacity: 0.6 } : undefined}
        role="listbox"
        aria-label="Matching project files"
      >
        {results?.files.map((file, index) => (
          <button
            id={"quick-file-" + index}
            key={file.path}
            role="option"
            aria-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onClick={() => choose(index)}
          >
            <FileCode2 size={17} />
            <span>
              <strong>{file.name}</strong>
              <small>{file.path}</small>
            </span>
            <ArrowUpRight size={13} />
          </button>
        ))}
        {!busy && !error && results && !results.files.length && (
          <div className="navigation-empty">
            <FileCode2 size={25} />
            <strong>No matching files</strong>
            <p>Try fewer characters or a different part of the path.</p>
          </div>
        )}
      </div>
      <p className="navigation-hint">
        ↑ ↓ choose · Enter opens · Escape cancels. Generated/dependency folders
        and symlinks are excluded.
      </p>
    </Modal>
  );
}
