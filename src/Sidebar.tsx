import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileCode2,
  RefreshCw,
  RotateCw,
  FolderOpen,
  Plus,
  GitBranch,
  Search,
  GripVertical,
  Bot,
  PanelsTopLeft,
} from "lucide-react";
import type { Connection, FileEntry, GitEntry, Inventory, Seat } from "./types";
import { ErrorBox, IconButton, StatusDot } from "./components";
function FileTree({
  connection,
  root,
  path = "",
  depth = 0,
  onFile,
  refresh,
}: {
  connection: Connection;
  root: string;
  path?: string;
  depth?: number;
  onFile: (path: string) => void;
  refresh: number;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    window.hrig
      .file(connection, { op: "list", root, path })
      .then((data) => {
        if (active) {
          setFiles(data);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [connection.id, root, path, refresh]);
  if (error) return <div className="tree-error">{error}</div>;
  return (
    <>
      {files.map((file) => (
        <div key={file.path}>
          <button
            className="file-row"
            style={{ paddingLeft: 14 + depth * 13 }}
            onClick={() => {
              if (file.directory)
                setExpanded((old) => {
                  const next = new Set(old);
                  next.has(file.path)
                    ? next.delete(file.path)
                    : next.add(file.path);
                  return next;
                });
              else onFile(file.path);
            }}
            title={file.path}
          >
            {file.directory ? (
              expanded.has(file.path) ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )
            ) : (
              <span className="tree-spacer" />
            )}
            {file.directory ? (
              <Folder size={14} className="folder-icon" />
            ) : (
              <FileCode2
                size={14}
                className={`file-icon ${file.name.split(".").pop()}`}
              />
            )}
            <span>{file.name}</span>
          </button>
          {file.directory && expanded.has(file.path) && (
            <FileTree
              connection={connection}
              root={root}
              path={file.path}
              depth={depth + 1}
              onFile={onFile}
              refresh={refresh}
            />
          )}
        </div>
      ))}
      {!files.length && depth === 0 && (
        <div className="sidebar-empty">This folder is empty.</div>
      )}
    </>
  );
}
export default function Sidebar({
  section,
  connection,
  root,
  inventory,
  inventoryError,
  busy,
  selectedRig,
  onRig,
  onRefresh,
  onProject,
  onConnect,
  onManageRigs,
  onSeat,
  onRelaunch,
  onDrag,
  onFile,
  onDiff,
  fileRevision,
}: {
  section: string;
  connection: Connection;
  root: string;
  inventory: Inventory | null;
  inventoryError: string;
  busy: boolean;
  selectedRig: string;
  onRig: (id: string) => void;
  onRefresh: () => void;
  onProject: () => void;
  onConnect: () => void;
  onManageRigs: () => void;
  onSeat: (seat: Seat) => void;
  onRelaunch: (seat: Seat) => void;
  onDrag: (event: React.DragEvent, seat: Seat) => void;
  onFile: (path: string) => void;
  onDiff: (path: string) => void;
  fileRevision: number;
}) {
  const [query, setQuery] = useState("");
  const [changes, setChanges] = useState<GitEntry[]>([]);
  const [gitError, setGitError] = useState("");
  const [isRepository, setIsRepository] = useState(true);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitRevision, setGitRevision] = useState(0);
  useEffect(() => {
    if (section !== "changes") return;
    let active = true;
    setGitLoading(true);
    setGitError("");
    setChanges([]);
    window.hrig
      .git(connection, root)
      .then((data) => {
        if (active) {
          setChanges(data.entries);
          setIsRepository(data.isRepository);
          setGitError("");
        }
      })
      .catch((e) => {
        if (active) setGitError(e.message);
      })
      .finally(() => {
        if (active) setGitLoading(false);
      });
    return () => {
      active = false;
    };
  }, [section, connection.id, root, fileRevision, gitRevision]);
  const rigs = inventory?.rigs || [];
  const seats = (inventory?.seats || []).filter(
    (s) =>
      (!selectedRig || s.rigId === selectedRig) &&
      (!query ||
        `${s.name} ${s.rigName} ${s.runtime}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        <span>
          {section === "files"
            ? "EXPLORER"
            : section === "changes"
              ? "SOURCE CONTROL"
              : "WORKSPACE"}
        </span>
        <div>
          {section === "files" ? (
            <>
              <IconButton title="Refresh files" onClick={onRefresh}>
                <RefreshCw size={13} />
              </IconButton>
              <IconButton title="Open project folder" onClick={onProject}>
                <FolderOpen size={14} />
              </IconButton>
            </>
          ) : (
            <IconButton
              title={section === "changes" ? "Refresh changes" : "Refresh rigs"}
              onClick={() =>
                section === "changes"
                  ? setGitRevision((n) => n + 1)
                  : onRefresh()
              }
            >
              <RefreshCw size={13} className={busy ? "spin" : ""} />
            </IconButton>
          )}
        </div>
      </div>
      <button className="project-card" onClick={onProject} title={root}>
        <span className="project-icon">
          <FolderOpen size={19} />
        </span>
        <span>
          <strong>
            {root === "~"
              ? "Home directory"
              : root.split(/[\\/]/).filter(Boolean).pop() || "Project"}
          </strong>
          <small>{root}</small>
        </span>
        <ChevronDown size={13} />
      </button>
      {section === "files" ? (
        <>
          <div className="section-label">
            <span>PROJECT FILES</span>
            <span className="key-hint">Ctrl O</span>
          </div>
          <div className="sidebar-scroll">
            <FileTree
              connection={connection}
              root={root}
              onFile={onFile}
              refresh={fileRevision}
            />
          </div>
        </>
      ) : section === "changes" ? (
        <>
          <div className="section-label">
            <span>CHANGES</span>
            <span className="count">{changes.length}</span>
          </div>
          <div className="sidebar-scroll">
            {gitLoading ? (
              <div className="sidebar-empty">Checking repository…</div>
            ) : gitError ? (
              <ErrorBox error={gitError} />
            ) : !isRepository ? (
              <div className="sidebar-empty">
                <GitBranch size={25} />
                <strong>Open a Git project</strong>
                <p>
                  This folder is not a Git repository. Choose your repository
                  folder to see changes.
                </p>
                <button className="small-button" onClick={onProject}>
                  Choose project folder
                </button>
              </div>
            ) : changes.length ? (
              changes.map((c) => (
                <button
                  className="change-row"
                  key={c.path}
                  onClick={() => onDiff(c.path)}
                >
                  <FileCode2 size={14} />
                  <span>{c.path}</span>
                  <b className={c.status === "??" ? "untracked" : ""}>
                    {c.status === "??" ? "U" : c.status}
                  </b>
                </button>
              ))
            ) : (
              <div className="sidebar-empty">
                <GitBranch size={25} />
                <strong>Working tree clean</strong>
                <p>Changes will appear here.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="sidebar-search">
            <Search size={13} />
            <input
              aria-label="Filter sessions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a session…"
            />
            <kbd>/</kbd>
          </div>
          <div className="section-label">
            <span>RIGS</span>
            <button title="Add connection" onClick={onConnect}>
              <Plus size={13} />
            </button>
          </div>
          <div className="rig-list">
            <button
              className="rig-row"
              onClick={onManageRigs}
              title="Design, launch, stop, or delete rigs"
            >
              <Plus size={14} />
              <span>Manage rigs</span>
            </button>
            <button
              className={`rig-row ${!selectedRig ? "selected" : ""}`}
              onClick={() => onRig("")}
            >
              <PanelsTopLeft size={14} />
              <span>All rigs</span>
              <span className="count">{rigs.length}</span>
            </button>
            {rigs.map((r) => (
              <button
                className={`rig-row ${r.id === selectedRig ? "selected" : ""}`}
                key={r.id}
                onClick={() => onRig(r.id)}
              >
                <StatusDot status={r.status} />
                <span>{r.name}</span>
                <span className="count">{r.nodeCount}</span>
              </button>
            ))}
          </div>
          <div className="section-label">
            <span>SESSIONS</span>
            <span className="count">{seats.length}</span>
          </div>
          <div className="sidebar-scroll">
            {inventoryError && inventory && (
              <div className="error-box" role="status">
                Stale inventory · Last success: {inventory.sampledAt}.{" "}
                {inventoryError}{" "}
                <button onClick={onRefresh}>Retry connection</button>
              </div>
            )}
            {inventoryError && !inventory ? (
              <div className="connection-empty">
                <Bot size={25} />
                <h4>
                  {connection.kind === "local"
                    ? "Connect your rig"
                    : "Rig unavailable"}
                </h4>
                <p>{inventoryError}</p>
                <button className="small-button" onClick={onConnect}>
                  Connection settings
                </button>
              </div>
            ) : seats.length ? (
              seats.map((s) => (
                <div className="session-row" key={s.id}>
                  <button
                    disabled={!!inventoryError}
                    draggable={!inventoryError}
                    onDragStart={(event) => onDrag(event, s)}
                    onClick={() => onSeat(s)}
                    className="seat-row"
                    key={s.id}
                    title={`${s.name}@${s.rigName}${s.session ? " · " + s.session : " · No terminal available"}`}
                  >
                    <span
                      className={`seat-avatar ${s.runtime?.includes("codex") ? "purple" : ""}`}
                    >
                      <Bot size={16} />
                    </span>
                    <span className="seat-details">
                      <strong>{s.name}</strong>
                      <small>
                        {s.rigName} · {s.runtime}
                      </small>
                    </span>
                    <StatusDot status={s.status} />
                    <GripVertical size={12} className="grip" />
                  </button>
                  <IconButton
                    title={`Relaunch session ${s.name}`}
                    disabled={!!inventoryError || !s.session}
                    onClick={() => onRelaunch(s)}
                  >
                    <RotateCw size={13} />
                  </IconButton>
                </div>
              ))
            ) : (
              <div className="connection-empty">
                <Bot size={26} />
                <h4>{busy ? "Discovering seats…" : "No seats yet"}</h4>
                <p>
                  {connection.kind === "local"
                    ? "Connect to WSL or SSH to see your OpenRig agents."
                    : "Running OpenRig seats will appear here. Refresh after starting your rig."}
                </p>
                {connection.kind === "local" && (
                  <button className="small-button" onClick={onConnect}>
                    Connect a machine
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="sidebar-tip">
            <GripVertical size={14} />
            <span>Drag sessions into the workspace to arrange them.</span>
          </div>
        </>
      )}
      <div className="sidebar-footer">
        <span className="connection-icon">
          {connection.kind === "wsl"
            ? "WSL"
            : connection.kind === "ssh"
              ? "SSH"
              : "WIN"}
        </span>
        <span>{connection.name}</span>
        <StatusDot
          status={
            connection.kind === "local"
              ? "idle"
              : inventory
                ? "running"
                : "unknown"
          }
        />
      </div>
    </aside>
  );
}
