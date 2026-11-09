import { useEffect, useRef, useState } from "react";
import { FileCode2, Search, ArrowUpRight } from "lucide-react";
import { ErrorBox, Modal } from "./components";
import type { Connection, FileEntry } from "./types";
import { recentRows, scanResetsSelection } from "./recent-files";
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
  recent,
  onOpen,
  onClose,
}: {
  connection: Connection;
  root: string;
  recent: string[];
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
  // An empty query lists the recent files while the project scan keeps running
  // behind them, so typing needs no extra round trip.
  const recents = recentRows(query, recent);
  const showingRecent = recents !== null;
  const loading = busy && !showingRecent;
  const rows: { name: string; path: string }[] =
    recents ?? results?.files ?? [];
  // A scan that finishes while the recents show must not undo the user's
  // ArrowDown or hover selection; a ref because the scan callback outlives
  // renders, the same pattern as the line ref.
  const scanResets = useRef(true);
  scanResets.current = scanResetsSelection(query, recent);
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
              if (scanResets.current) setSelected(0);
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
    // Whatever Enter was waiting for belonged to a query that is gone; without
    // this a pending Enter from a line-suffix query would open the first
    // scanned file once the scan returns.
    setSelected(0);
    if (showingRecent) openWhenReady.current = false;
  }, [showingRecent]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const lineRef = useRef(line);
  lineRef.current = line;
  const choose = (index: number, fromKeyboard = false) => {
    if (loading && fromKeyboard) {
      openWhenReady.current = true;
      return;
    }
    const file = rows[index];
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
            rows.length ? "quick-file-" + selected : undefined
          }
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const count = rows.length;
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
        {showingRecent
          ? "Recent files · most recent first · type to search the project"
          : loading
            ? "Searching project files…"
            : results
              ? `${results.files.length} shown · ${results.matches} matches · ${results.scannedFiles} files scanned${results.partial ? " · Partial scan: some folders were skipped or the scan limit was reached." : ""}${results.limited ? " · Best 100 matches shown." : ""}`
              : ""}
      </div>
      <div
        ref={list}
        id="quick-open-results"
        className="navigation-results"
        aria-busy={loading}
        style={loading && results ? { opacity: 0.6 } : undefined}
        role="listbox"
        aria-label={showingRecent ? "Recent files" : "Matching project files"}
      >
        {rows.map((file, index) => (
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
        {!busy &&
          !error &&
          !showingRecent &&
          results &&
          !results.files.length && (
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
