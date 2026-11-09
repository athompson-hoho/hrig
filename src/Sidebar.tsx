import { VirtualList } from "./VirtualList";
import FileExplorer, { type ActiveFileTarget } from "./FileExplorer";
import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
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
  Pin,
} from "lucide-react";
import type { Connection, GitEntry, Inventory, Seat } from "./types";
import { ErrorBox, IconButton, StatusDot } from "./components";
import { formatAge } from "./inventory-health";
import { connectionStatus } from "./connection-status";
import { seatActivityAge } from "./seat-activity-age";
import { seatWorkSummary } from "./seat-work";
import { filterSeats } from "./seat-search";
import { filterSeatsByStatus, type SeatStatusFilter } from "./seat-status";
import { sortSeats } from "./seat-sort";
import { normalizePinnedSeats, partitionPinnedSeats, seatPinIdentity, pinConnectionIdentity } from "./seat-pins";
import { groupSeatPods, normalizeCollapsedPods } from "./seat-pods";
import { useSettings } from "./SettingsContext";
function InventoryAge({ sampledAt }: { sampledAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatAge(now - Date.parse(sampledAt))}</>;
}
export default function Sidebar({
  section,
  connection,
  root,
  inventory,
  inventoryError,
  busy,
  selectedRig,
  pinnedSeats,
  pinsAvailable,
  onToggleSeatPin,
  collapsedPods,
  podsAvailable,
  onTogglePod,
  onRig,
  onRefresh,
  onProject,
  onConnect,
  onManageRigs,
  onSeat,
  onSeatBeside,
  onSeatPrompt,
  onSeatTranscript,
  onPodGrid,
  onSeatMessage,
  onRelaunch,
  onDrag,
  onFile,
  onDiff,
  fileRevision,
  activeFile,
}: {
  section: string;
  connection: Connection;
  root: string;
  inventory: Inventory | null;
  inventoryError: string;
  busy: boolean;
  selectedRig: string;
  collapsedPods: readonly string[];
  podsAvailable: boolean;
  onTogglePod: (seat: Seat) => void;
  pinnedSeats: readonly string[];
  pinsAvailable: boolean;
  onToggleSeatPin: (seat: Seat) => void;
  onRig: (id: string) => void;
  onRefresh: () => void;
  onProject: () => void;
  onConnect: () => void;
  onManageRigs: () => void;
  onSeat: (seat: Seat) => void;
  onSeatBeside?: (seat: Seat) => void;
  onSeatPrompt?: (seat: Seat) => void;
  onSeatTranscript?: (seat: Seat) => void;
  onPodGrid?: (seats: Seat[]) => void;
  onSeatMessage?: (seat: Seat) => void;
  onRelaunch: (seat: Seat) => void;
  onDrag: (event: React.DragEvent, seat: Seat) => void;
  onFile: (path: string) => void;
  onDiff: (path: string) => void;
  fileRevision: number;
  activeFile?: ActiveFileTarget | null;
}) {
  const podNamespace = useId();
  const podTokens = useRef(new Map<string, number>());
  const [query, setQuery] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const { effective, project, update } = useSettings();
  const [statusFilter, setStatusFilter] = useState<SeatStatusFilter>("all");
  const [changes, setChanges] = useState<GitEntry[]>([]);
  const [gitOmittedPaths, setGitOmittedPaths] = useState(0);
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
    setGitOmittedPaths(0);
    window.hrig
      .git(connection, root)
      .then((data) => {
        if (active) {
          if (data.omittedPaths !== undefined && (!Number.isSafeInteger(data.omittedPaths) || data.omittedPaths < 0))
            throw new Error("Git status is unavailable for this project.");
          setChanges(data.entries);
          setGitOmittedPaths(data.omittedPaths || 0);
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
  const searchResult = filterSeats(inventory?.seats || [], selectedRig, query);
  const pins = new Set(pinsAvailable ? normalizePinnedSeats(pinnedSeats) : []);
  const seats = partitionPinnedSeats(sortSeats(
    filterSeatsByStatus(searchResult.seats, statusFilter),
    effective["rig.seatSort"],
  ), connection, pinsAvailable ? pinnedSeats : []);
  const noMatches = searchResult.scopedCount > 0 &&
    (searchResult.hasQuery || statusFilter !== "all") && seats.length === 0;
  const favorites = seats.filter(s => pins.has(seatPinIdentity(connection, s.id)));
  const groups = groupSeatPods(seats.filter(s => !pins.has(seatPinIdentity(connection, s.id))), connection);
  const collapsed = new Set(podsAvailable ? normalizeCollapsedPods(collapsedPods) : []);
  const selectOnly = effective["rig.seatClick"] === "select";
  const activityClock = Date.now(); // reader clock; refreshed by existing inventory rerenders, no timer
  const ageCurrent = !inventoryError && pinsAvailable;
  const connState = connectionStatus({
    error: inventoryError,
    hasInventory: !!inventory,
    busy,
    local: connection.kind === "local",
  });
  const renderSeat = (s: Seat) => {
    const age = seatActivityAge(s.lastActivityAt, activityClock, ageCurrent);
    const work = seatWorkSummary(s.assignedWork, s.pendingWork, ageCurrent);
    return (
    <div className="session-row" key={s.id}>
      <button
        disabled={!!inventoryError}
        draggable={!inventoryError}
        onDragStart={(event) => onDrag(event, s)}
        onClick={() => { if (selectOnly) setSelectedSeat(s.id); else onSeat(s); }}
        aria-pressed={selectOnly ? selectedSeat === s.id : undefined}
        className={`seat-row${selectOnly && selectedSeat === s.id ? " selected" : ""}`}
        key={s.id}
        title={`${s.name}@${s.rigName}${s.session ? " · " + s.session : " · No terminal available"} · ${age.tooltip} ${work.tooltip}`}
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
            {age.available && (
              <span className="seat-age" aria-label={age.label}> · {age.text} ago</span>
            )}
          </small>
        </span>
        {work.badge && (
          <span className="seat-work" aria-label={work.label}>{work.badge}</span>
        )}
        <StatusDot status={s.status} />
        <GripVertical size={12} className="grip" />
      </button>
      <button
        type="button"
        className="icon-button seat-pin"
        disabled={!pinsAvailable}
        aria-pressed={pins.has(seatPinIdentity(connection, s.id))}
        aria-label={`${pins.has(seatPinIdentity(connection, s.id)) ? "Unpin" : "Pin"} session ${s.name} in ${s.rigName}`}
        title={`${pins.has(seatPinIdentity(connection, s.id)) ? "Unpin" : "Pin"} session ${s.name} in ${s.rigName}`}
        onClick={() => { if (pinsAvailable) onToggleSeatPin(s); }}
      >
        <Pin size={13} aria-hidden="true" fill={pins.has(seatPinIdentity(connection, s.id)) ? "currentColor" : "none"} />
      </button>
      {selectOnly && (
        <IconButton title={`Open terminal for ${s.name}`} disabled={!!inventoryError || !s.session} onClick={() => onSeat(s)}><span aria-hidden="true">▶</span></IconButton>
      )}
      {onSeatBeside && <IconButton title={`Open ${s.name} beside current`} disabled={!!inventoryError || !s.session} onClick={() => onSeatBeside(s)}><span aria-hidden="true">▥</span></IconButton>}
      {onSeatPrompt && s.status === "attention" && (
        <IconButton title={`View pending prompt for ${s.name} (read-only)`} disabled={!!inventoryError || !s.session || !ageCurrent} onClick={() => onSeatPrompt(s)}><span aria-hidden="true">?</span></IconButton>
      )}
      {onSeatTranscript && (
        <IconButton title={`View recent transcript for ${s.name} (read-only)`} disabled={!!inventoryError || !s.session || !ageCurrent} onClick={() => onSeatTranscript(s)}><span aria-hidden="true">≡</span></IconButton>
      )}
      {onSeatMessage && (
        <IconButton title={`Message ${s.name} (reviewed before sending)`} disabled={!!inventoryError || !s.session || !ageCurrent} onClick={() => onSeatMessage(s)}><span aria-hidden="true">✉</span></IconButton>
      )}
      <IconButton
        title={`Relaunch session ${s.name}`}
        disabled={!!inventoryError || !s.session}
        onClick={() => onRelaunch(s)}
      >
        <RotateCw size={13} />
      </IconButton>
    </div>
    );
  };
  type SessionRow = { key: string; seat: Seat; group?: typeof groups[number] }
    | { key: string; group: typeof groups[number]; seat?: undefined };
  const owner = pinConnectionIdentity(connection);
  const sessionRows: SessionRow[] = favorites.map(seat => ({ key: JSON.stringify([owner, "favorite", seat.id]), seat }));
  for (const group of groups) {
    sessionRows.push({ key: JSON.stringify([owner, "pod", group.identity]), group });
    if (!collapsed.has(group.identity)) for (const seat of group.seats)
      sessionRows.push({ key: JSON.stringify([owner, "seat", group.identity, seat.id]), group, seat });
  }
  const renderSession = (row: SessionRow) => {
    if (row.seat) return renderSeat(row.seat);
    const group = row.group;
    if (!podTokens.current.has(group.identity))
      podTokens.current.set(group.identity, podTokens.current.size);
    const id = `${podNamespace}-pod-${podTokens.current.get(group.identity)}`;
    const expanded = !collapsed.has(group.identity);
    const attention = group.seats.filter(seat => seat.status === "attention").length;
    const label = `${expanded ? "Collapse" : "Expand"} pod ${group.podLabel} in rig ${group.rigLabel}`;
    return (
      <div className="pod-group">
        <button type="button" className="pod-disclosure" disabled={!podsAvailable}
          aria-expanded={expanded} aria-describedby={`${id}-description`}
          aria-label={label} title={label}
          onClick={() => { if (podsAvailable) onTogglePod(group.seats[0]); }}>
          {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          <span className="pod-label">{group.podLabel} · {group.rigLabel}</span>
          <span className="count">{group.seats.length}</span>
          {!expanded && attention > 0 && <span className="pod-attention"><span className="status-dot attention" aria-hidden="true" />{attention} need input</span>}
        </button>
        {onPodGrid && (
          <IconButton
            className="pod-grid-open"
            title={`Open the ${group.seats.length} matching unpinned ${group.seats.length === 1 ? "session" : "sessions"} of pod ${group.podLabel} as a grid (pinned sessions are in Favorites)`}
            disabled={!!inventoryError || !podsAvailable}
            onClick={() => onPodGrid(group.seats)}
          >
            <PanelsTopLeft size={13} aria-hidden="true" />
          </IconButton>
        )}
        <span className="sr-only" id={`${id}-description`}>
          {group.seats.length} matching unpinned {group.seats.length === 1 ? "session" : "sessions"}.
          {!expanded && attention > 0 && ` ${attention} need input.`}
          {!podsAvailable && " Pod controls unavailable while this snapshot belongs to another connection."}
        </span>
      </div>
    );
  };
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
          <FileExplorer
            connection={connection}
            root={root}
            onFile={onFile}
            refresh={fileRevision}
            activeFile={activeFile}
          />
        </>
      ) : section === "changes" ? (
        <>
          <div className="section-label">
            <span>CHANGES</span>
            <span className="count">{changes.length}</span>
          </div>
          <div className="sidebar-scroll">
            {!gitLoading && !gitError && isRepository && gitOmittedPaths > 0 &&
              <div className="sidebar-empty" role="status">{gitOmittedPaths} paths not shown.</div>}
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
                <strong>{gitOmittedPaths ? "No shown Git changes" : "Working tree clean"}</strong>
                <p>{gitOmittedPaths ? "Some reported paths could not be shown." : "Changes will appear here."}</p>
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
          <select
            aria-label="Filter session status"
            className="sidebar-status-filter"
            value={statusFilter}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "all" || value === "working" || value === "idle" ||
                  value === "attention" || value === "stopped") setStatusFilter(value);
            }}
          >
            <option value="all">All statuses</option>
            <option value="working">Working</option>
            <option value="idle">Idle</option>
            <option value="attention">Needs input</option>
            <option value="stopped">Stopped</option>
          </select>
          <select
            aria-label="Sort sessions"
            className="sidebar-status-filter"
            value={effective["rig.seatSort"]}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "name" || value === "activity" || value === "attention-first")
                update(Object.hasOwn(project, "rig.seatSort") ? "project" : "user",
                  "rig.seatSort", value);
            }}
          >
            <option value="name">Name</option>
            <option value="activity">Activity (working first)</option>
            <option value="attention-first">Attention first</option>
          </select>
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
            {rigs.length > 0 && <VirtualList rows={rigs} itemKey={r => JSON.stringify([owner, "rig", r.id])}
              scopeKey={owner} label="Rig list" maxHeight={136} estimateHeight={34}
              className="sidebar-rig-viewport" renderRow={r => (
              <button
                className={`rig-row ${r.id === selectedRig ? "selected" : ""}`}
                key={r.id}
                onClick={() => onRig(r.id)}
              >
                <StatusDot status={r.status} />
                <span>{r.name}</span>
                <span className="count">{r.nodeCount}</span>
              </button>
            )} />}
          </div>
          <div className="section-label">
            <span title="Matching sessions, including favorites and sessions in collapsed pods.">SESSIONS</span>
            <span className="count">{seats.length}</span>
          </div>
          <div className="sidebar-scroll sidebar-session-container">
            {connState.banner === "refreshing" && inventory && (
              <div className="sidebar-empty" role="status">
                Refreshing · showing the last known snapshot… Last updated{" "}
                <InventoryAge sampledAt={inventory.sampledAt} />.
              </div>
            )}
            {connState.banner === "stale" && inventory && (
              <div className="error-box" role="status">
                Stale inventory · last updated{" "}
                <InventoryAge sampledAt={inventory.sampledAt} />. {inventoryError}{" "}
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
            ) : noMatches ? (
              <div className="sidebar-empty" role="status">
                <strong>No matching sessions</strong>
                <p>Try another search or clear the filters.</p>
              </div>
            ) : seats.length ? (
              <VirtualList rows={sessionRows} itemKey={row => row.key} renderRow={renderSession}
                groupRow={row => row.seat && row.group ? {
                  key: JSON.stringify([owner, row.group.identity]),
                  label: `${row.group.podLabel} · ${row.group.rigLabel}`, className: "pod-content",
                } : undefined}
                label="Sessions" scopeKey={owner} className="sidebar-session-viewport" />
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
            <span>Drag sessions into the workspace to arrange them. Favorites stay visible when their pod is collapsed.</span>
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
