import { cloneElement, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Folder, Search } from "lucide-react";
import type { Connection, FileEntry } from "./types";
import { compareFileEntries, fileTreeOwner, normalizeFileQuery, projectFileMatches, resolveRevealPath } from "./file-tree";

export type ActiveFileTarget = { connection: Connection; root: string; path: string };
type Props = { connection: Connection; root: string; refresh: number;
  activeFile?: ActiveFileTarget | null; onFile: (path: string) => void };
type Listing = { files: FileEntry[]; error?: boolean };
const unavailable = "The active file is not available in this project. Select its matching connection and project to reveal it.";
const missing = "The active file is not available in the directory listings. Refresh or select another file.";
const cancelled = "Reveal cancelled. Select Reveal active file to try again.";

// This outer ref changes during render, before keyed children run their cleanup.
export default function FileExplorer(props: Props) {
  const owner = fileTreeOwner(props.connection, props.root);
  const latest = useRef(owner);
  latest.current = owner;
  return <Explorer key={owner} {...props} currentOwner={() => latest.current === owner} />;
}

function Explorer({ connection, root, refresh, activeFile, onFile, currentOwner }: Props & { currentOwner: () => boolean }) {
  const [query, setQuery] = useState("");
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [search, setSearch] = useState<{ token: object; files?: FileEntry[]; error?: boolean } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [verification, setVerification] = useState<{ refresh: number; listings: Map<string, Listing> } | null>(null);
  const verified = verification?.refresh === refresh ? verification.listings : undefined;
  const [reveal, setReveal] = useState<{ token: object; state: "pending" | "success" | "missing" | "error"; path: string } | null>(null);
  const alive = useRef(true);
  const owner = fileTreeOwner(connection, root);
  const target = activeFile ? JSON.stringify([fileTreeOwner(activeFile.connection, activeFile.root), activeFile.path]) : "";
  const signature = JSON.stringify([query, target, refresh, searchAttempt]);
  const lifetime = useRef({ signature, token: {} });
  if (lifetime.current.signature !== signature) lifetime.current = { signature, token: {} };
  const token = lifetime.current.token;
  const current = () => alive.current && currentOwner() && lifetime.current.token === token;
  const currentListOwner = () => alive.current && currentOwner() && latestRefresh.current === refresh;
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  const normalView = () => current() && normalizeFileQuery(query) === "";
  const normalized = normalizeFileQuery(query);
  const filtered = normalized !== "";
  const relative = activeFile && fileTreeOwner(activeFile.connection, activeFile.root) === owner
    ? resolveRevealPath(connection, root, activeFile.path, window.hrig.platform) : null;
  const reason = !activeFile ? "Select an editor or diff in this project to reveal its file." : !relative ? unavailable : "";
  const id = useId();
  const scrolled = useRef<object | null>(null);
  const shownReveal = reveal?.token === token ? reveal : null;
  const shownSearch = search?.token === token ? search : null;
  const pendingSearch = filtered && normalized !== null && !shownSearch?.files && !shownSearch?.error;
  const pendingReveal = shownReveal?.state === "pending";
  const changeQuery = (value: string) => {
    if (!current() || value === query) return;
    lifetime.current = { ...lifetime.current, token: {} };
    setQuery(value);
  };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!normalized || !current()) return;
    let active = true;
    const timer = setTimeout(() => {
      if (!active || !current()) return;
      Promise.resolve().then(() => {
        if (!active || !current()) return null;
        return window.hrig.file(connection, { op: "search", root, path: "", query: normalized });
      }).then(data => {
        if (data && active && current()) setSearch({ token, files: projectFileMatches(data) });
      }).catch(() => { if (active && current()) setSearch({ token, error: true }); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [signature]);

  const revealFile = async () => {
    if (!current() || !relative || pendingReveal) return;
    // The explicit action owns a new view with an empty filter.
    const nextSignature = JSON.stringify(["", target, refresh, searchAttempt]);
    const revealToken = {};
    lifetime.current = { signature: nextSignature, token: revealToken };
    setQuery("");
    setReveal({ token: revealToken, state: "pending", path: relative });
    const valid = () => alive.current && currentOwner() && lifetime.current.token === revealToken;
    const listings = new Map<string, Listing>();
    const ancestors: string[] = [];
    const parts = relative.split("/");
    let parent = "";
    try {
      for (let i = 0; i < parts.length; i++) {
        if (!valid()) return;
        const files: FileEntry[] = await window.hrig.file(connection, { op: "list", root, path: parent });
        if (!valid()) return;
        listings.set(parent, { files });
        const path = parts.slice(0, i + 1).join("/");
        if (!files.slice(0, 600).some(entry => entry.path === path && entry.directory === (i < parts.length - 1))) {
          setReveal({ token: revealToken, state: "missing", path: relative }); return;
        }
        if (i < parts.length - 1) ancestors.push(path);
        parent = path;
      }
      if (!valid()) return;
      setVerification({ refresh, listings });
      setExpanded(old => new Set([...old, ...ancestors]));
      setReveal({ token: revealToken, state: "success", path: relative });
    } catch {
      if (valid()) setReveal({ token: revealToken, state: "error", path: relative });
    }
  };
  const projection = shownSearch?.files || [];
  const count = projection.filter(file => !file.directory).length;
  const searchError = normalized === null || shownSearch?.error;
  const status = pendingReveal ? "Revealing active file…" : pendingSearch ? "Searching files…" :
    shownReveal?.state === "success" ? `Revealed ${shownReveal.path}.` :
    shownReveal?.state === "missing" ? missing :
    filtered && !searchError ? count === 100 ? "First 100 matching files shown. More files may match." :
      count ? `${count} matching files in the searched scope.` : "No matching files in the searched scope." :
    reveal?.state === "pending" && !shownReveal ? cancelled : "";
  const row = (file: FileEntry, depth: number, context = false) => {
    const highlighted = !context && shownReveal?.state === "success" && shownReveal.path === file.path;
    const content = <>{file.directory ? expanded.has(file.path) || context ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span className="tree-spacer" />}
      {file.directory ? <Folder size={14} className="folder-icon" /> : <FileCode2 size={14} className={`file-icon ${file.name.split(".").pop()}`} />}
      <span>{file.name}</span>{highlighted && <span className="sr-only">Revealed file</span>}</>;
    if (context && file.directory) return <div key={file.path} className="file-row" title={file.path} aria-label={file.path}
      style={{ paddingLeft: 14 + depth * 13 }}>{content}</div>;
    return <button key={file.path} type="button" className={`file-row${highlighted ? " file-revealed" : ""}`}
      title={file.path} aria-label={file.path} aria-expanded={file.directory ? expanded.has(file.path) : undefined}
      style={{ paddingLeft: 14 + depth * 13 }}
      ref={highlighted ? node => {
        if (node && current() && scrolled.current !== token) {
          scrolled.current = token; node.scrollIntoView({ block: "nearest" });
        }
      } : undefined}
      onClick={() => {
        if (!current() || (!context && !normalView())) return;
        if (!context && (file.directory || reveal)) lifetime.current = { ...lifetime.current, token: {} };
        if (file.directory) {
          setReveal(null);
          setExpanded(old => { const next = new Set(old); next.has(file.path) ? next.delete(file.path) : next.add(file.path); return next; });
        } else { setReveal(null); onFile(file.path); }
      }}>{content}</button>;
  };
  return <div className="file-explorer sidebar-scroll">
    <div className="sidebar-search file-filter">
      <Search size={13} />
      <input aria-label="Filter project files" placeholder="Filter files by name or path…" maxLength={300}
        title={query} aria-describedby={`${id}-scope`} value={query} onChange={e => changeQuery(e.target.value)} />
      {query !== "" && <button type="button" aria-label="Clear file filter" title="Clear file filter" onClick={() => changeQuery("")}>Clear</button>}
    </div>
    <div className="explorer-notice" id={`${id}-scope`}>Files only · up to 100 matches · up to 20,000 files searched. Excluded or unreadable paths may be omitted.
      {connection.kind === "local" && <span> Local search also stops at depth 25.</span>}</div>
    <div className="explorer-reveal">
      <button type="button" title="Reveal active file" aria-label="Reveal active file" aria-describedby={`${id}-reason`}
        disabled={!!reason || pendingReveal} onClick={revealFile}>Reveal active file</button>
      <div id={`${id}-reason`} className="explorer-notice">{reason}</div>
    </div>
    <div className="explorer-notice" role="status" aria-live="polite" aria-atomic="true" aria-busy={pendingSearch || pendingReveal}>{status}</div>
    {searchError && filtered && <div className="tree-error" role="alert">Could not search this project. Retry or clear the filter.
      <button type="button" onClick={() => { if (current()) setSearchAttempt(n => n + 1); }}>Retry search</button></div>}
    {shownReveal?.state === "error" && <div className="tree-error" role="alert">Could not reveal the active file. Retry.
      <button type="button" onClick={revealFile}>Retry reveal</button></div>}
    {filtered && !pendingSearch && !searchError && count === 0 && <div className="explorer-notice">Try another name or path, or clear the filter.</div>}
    <div hidden={filtered} className="file-normal-tree">
      <div className="explorer-notice">Directory listings show up to 600 entries. Excluded paths may be omitted.</div>
      <FileTree key={refresh} connection={connection} root={root} path="" depth={0} expanded={expanded}
        verified={verified} valid={currentListOwner} actionable={normalView} renderRow={row} />
    </div>
    {filtered && !pendingSearch && !searchError && <div className="file-filter-matches" aria-describedby={`${id}-scope`}>
      {projection.map(file => row(file, file.path.split("/").length - 1, true))}
    </div>}
  </div>;
}

function FileTree({ connection, root, path, depth, expanded, verified, valid, actionable, renderRow }: {
  connection: Connection; root: string; path: string; depth: number; expanded: Set<string>;
  verified?: Map<string, Listing>; valid: () => boolean; actionable: () => boolean;
  renderRow: (file: FileEntry, depth: number) => React.ReactNode;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const latestAttempt = useRef(attempt);
  latestAttempt.current = attempt;
  const supplied = verified?.get(path);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (supplied) return;
    let active = true;
    setListing(null);
    Promise.resolve().then(() => {
      if (!active || !valid()) return null;
      return window.hrig.file(connection, { op: "list", root, path });
    }).then(files => { if (files && active && valid()) setListing({ files }); })
      .catch(() => { if (active && valid()) setListing({ files: [], error: true }); });
    return () => { active = false; };
  }, [path, attempt, supplied]);
  const data = supplied || listing;
  const latestData = useRef(data);
  latestData.current = data;
  const active = () => mounted.current && valid() && actionable() && latestAttempt.current === attempt && latestData.current === data;
  if (!data) return <div className="sidebar-empty">{depth ? "Loading folder…" : "Loading files…"}</div>;
  if (data.error) return <div role="alert" className="tree-error">Could not list this folder. Retry.
    <button type="button" onClick={() => { if (active()) setAttempt(n => n + 1); }}>Retry folder</button></div>;
  const files = data.files.slice(0, 600).filter(file => {
    const relative = resolveRevealPath(connection, root, file.path, window.hrig.platform);
    return relative === file.path && file.path.slice(0, file.path.lastIndexOf("/") + 1) === (path ? path + "/" : "");
  }).sort(compareFileEntries);
  return <>{files.map(file => {
    const rendered = renderRow(file, depth);
    // Bind row lifetime as well as owner/view lifetime; collapsed children cannot act later.
    return <div key={file.path}>
      <GuardedRow row={rendered} valid={active} />
      {file.directory && expanded.has(file.path) && <FileTree connection={connection} root={root} path={file.path}
        depth={depth + 1} expanded={expanded} verified={verified} valid={valid} actionable={actionable} renderRow={renderRow} />}
    </div>;
  })}{!files.length && <div className="sidebar-empty">{depth ? "No entries in this directory listing." : "No files are available in this directory listing."}</div>}</>;
}

function GuardedRow({ row, valid }: { row: React.ReactNode; valid: () => boolean }) {
  // A native row is produced by the Explorer; preserve its ref and exact callback.
  const element = row as React.ReactElement<{ onClick: () => void }>;
  return cloneElement(element, { onClick: () => { if (valid()) element.props.onClick(); } });
}
