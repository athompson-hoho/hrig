import { useEffect, useId, useRef, useState } from "react";
import { useSettings } from "./SettingsContext";
import { projectDiagnosticsRequest } from "../electron/diagnostics-bundle.mjs";
import {
  Activity,
  AlertCircle,
  Check,
  Network,
  RefreshCw,
  FileSearch,
  FilePlus,
  FolderPen,
  Globe,
  Play,
  Square,
  GitBranch,
  Send,
  ListTodo,
} from "lucide-react";
import type { Connection, Seat, Inventory, PanelConfig } from "./types";
import { ErrorBox, Loading, StatusDot, Empty } from "./components";
import { attentionSeats, attentionJumpEligibility } from "./attention-inbox";
import { pinConnectionIdentity } from "./seat-pins";
import RigDesigner, { DeleteRig } from "./RigDesigner";
export function DoctorPanel({ connection }: { connection: Connection }) {
  const { effective } = useSettings();
  // Keep full raw identity internal. No display normalization grants authority.
  const owner = JSON.stringify([connection.id, connection.name, connection.kind, connection.host, connection.port, connection.distro, connection.root, connection.rigBinary]);
  const current = useRef({ owner, mounted: true, generation: 0 });
  if (current.current.owner !== owner) {
    current.current = { owner, mounted: current.current.mounted, generation: current.current.generation + 1 };
  }
  const reportOwner = useRef<{ owner: string; generation: number } | null>(null);
  const inFlight = useRef(false);
  const doctorRequest = useRef(0);
  const [exportState, setExportState] = useState({ owner, generation: current.current.generation, busy: false, notice: '' });
  const descriptionId = useId();
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; current.current.generation++; };
  }, []);
  useEffect(() => {
    let active = true;
    const generation = current.current.generation;
    const request = ++doctorRequest.current;
    const isCurrent = () => active && doctorRequest.current === request && current.current.mounted && current.current.owner === owner && current.current.generation === generation;
    reportOwner.current = null;
    setReport(null);
    setError("");
    setChecking(true);
    window.hrig
      .doctor(connection)
      .then((r) => {
        if (isCurrent()) { reportOwner.current = { owner, generation }; setReport(r); }
      })
      .catch((e) => {
        if (isCurrent()) setError(e.message);
      })
      .finally(() => {
        if (isCurrent()) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [owner, revision]);
  const eligible = reportOwner.current?.owner === owner && reportOwner.current.generation === current.current.generation && !checking && !error;
  const available = JSON.parse(projectDiagnosticsRequest(report, effective, eligible)).checks.availability === 'available';
  const exportCurrent = exportState.owner === owner && exportState.generation === current.current.generation;
  const busy = exportCurrent && exportState.busy;
  const exportDiagnostics = async () => {
    if (inFlight.current || !current.current.mounted || current.current.owner !== owner) return;
    inFlight.current = true;
    const generation = current.current.generation;
    const isCurrent = () => current.current.mounted && current.current.owner === owner && current.current.generation === generation;
    setExportState({ owner, generation, busy: true, notice: 'Preparing diagnostics export…' });
    let notice = 'Could not save diagnostics. The destination may already exist, or the filesystem may not support this export. Try a new file name on a supported, writable filesystem.';
    try {
      const request = projectDiagnosticsRequest(report, effective, eligible);
      const result = await window.hrig.exportDiagnostics(request);
      if (result?.status === 'saved') notice = 'Diagnostics saved.';
      else if (result?.status === 'canceled') notice = 'Export canceled. No file was saved.';
    } catch { /* Only fixed copy crosses into this region. */ }
    finally {
      inFlight.current = false;
      if (isCurrent()) setExportState({ owner, generation, busy: false, notice });
    }
  };
  return (
    <div className="tool-panel doctor-panel">
      <div className="tool-panel-heading">
        <Network />
        <div>
          <h3>Connection doctor</h3>
          <p>{connection.name} · checks the actual login environment</p>
        </div>
        <button
          className="small-button"
          onClick={() => {
            doctorRequest.current++;
            reportOwner.current = null;
            setChecking(true);
            setError("");
            setRevision((n) => n + 1);
          }}
        >
          <RefreshCw size={13} />
          Run checks
        </button>
      </div>
      <section className="diagnostics-export">
        <div className="diagnostics-export-actions">
          <button type="button" className="small-button diagnostics-export-action" disabled={busy} aria-busy={busy}
            aria-describedby={`${descriptionId}-scope ${descriptionId}-new-file ${descriptionId}-snapshot`} onClick={exportDiagnostics}>
            {busy ? 'Exporting…' : 'Export redacted diagnostics…'}
          </button>
        </div>
        <p id={`${descriptionId}-scope`}>Includes represented Connection doctor check statuses, local HRig and runtime versions, and selected settings. Excludes check details, terminal text, connection names, host identities and free-form settings.</p>
        <p id={`${descriptionId}-new-file`}>Choose a new file name. Existing files are not replaced.</p>
        <p id={`${descriptionId}-snapshot`}>{available ? 'Uses the represented check-status snapshot; exporting does not run checks. Missing or invalid check statuses are recorded as unknown.' : 'Check statuses are unavailable. You can still export local versions and selected settings.'}</p>
        <p className="diagnostics-export-result" role="status" aria-live="polite" aria-atomic={true}>{exportCurrent ? exportState.notice : ''}</p>
      </section>
      {error && <ErrorBox error={error} />}{" "}
      {checking ? (
        <Loading text="Checking connection and dependencies…" />
      ) : report ? (
        <>
          <div
            className={`diagnostic-summary ${report.healthy ? "good" : "warning"}`}
          >
            {report.healthy ? <Check size={17} /> : <AlertCircle size={17} />}{" "}
            {report.healthy
              ? "Connection is ready"
              : "Some checks need attention"}
          </div>
          {(Array.isArray(report.checks) ? report.checks : []).filter((check: any) => check && typeof check === 'object').map((check: any) => (
            <div className="diagnostic-check" key={check.name}>
              {check.ok ? <Check size={16} /> : <AlertCircle size={16} />}
              <section>
                <strong>{check.name}</strong>
                <pre>{check.detail}</pre>
              </section>
            </div>
          ))}
          <p className="field-note">
            HRig initializes an existing NVM installation inside its command
            environment. It does not install dependencies or edit your shell
            profiles.
          </p>
        </>
      ) : null}
    </div>
  );
}
export function AttentionPanel({
  connection,
  inventory,
  onSeat,
  scope,
  notifications,
  onNotifications,
}: {
  connection: Connection;
  inventory: Inventory | null;
  onSeat: (seat: Seat, diagnostic?: boolean) => string;
  scope: { ready: boolean; reason: string };
  notifications: boolean;
  onNotifications: (value: boolean) => void;
}) {
  const [blocked, setBlocked] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [refusal, setRefusal] = useState("");
  const [blockedOwner, setBlockedOwner] = useState("");
  const descriptionId = useId();
  const owner = pinConnectionIdentity(connection);
  useEffect(() => {
    let active = true;
    setBlockedOwner(owner);
    setBlocked(null);
    setError("");
    const load = () =>
      window.hrig
        .queue(connection)
        .then((items) => {
          if (active) {
            setBlocked(
              items.filter((i) =>
                ["blocked", "failed"].includes(String(i.status)),
              ),
            );
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    load();
    const timer = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [owner]);
  const ownedBlocked = blockedOwner === owner ? blocked : null;
  const ownedError = blockedOwner === owner ? error : "";
  const seats = attentionSeats(inventory);
  const problems = inventory?.seats.filter((seat) => seat.status === "failed" && seat.error) || [];
  const context = (seat: Seat) => `${seat.name || "Seat name unavailable"} · ${seat.rigName || seat.rigId || "Rig unavailable"} · ${seat.pod || "Pod unavailable"} · ${connection.name}`;
  const row = (seat: Seat, index: number, diagnostic = false) => {
    const reason = !scope.ready ? scope.reason : attentionJumpEligibility(inventory, seat, diagnostic);
    const reasonId = `${descriptionId}-${diagnostic ? "problem" : "input"}-${index}`;
    return <div className="attention-row attention-inbox-row" key={`${seat.id}:${index}`}>
      <StatusDot status={diagnostic ? "failed" : "attention"} />
      <section><strong>{context(seat)}</strong>
        <p>{diagnostic ? "Failed" : "Needs input"} · Session: {seat.session || "unavailable"}</p>
        {seat.error && <p>{seat.error}</p>}
        {reason && <p id={reasonId}>{reason}</p>}
      </section>
      <button className="small-button" disabled={!!reason} aria-describedby={reason ? reasonId : undefined}
        aria-label={`${diagnostic ? "Open" : "Jump to"} ${seat.name || "Seat name unavailable"} in ${seat.rigName || seat.rigId || "Rig unavailable"}, pod ${seat.pod || "Pod unavailable"}, on ${connection.name}`}
        onClick={() => setRefusal(onSeat(seat, diagnostic) || "")}>{diagnostic ? "Open seat →" : "Jump to seat →"}</button>
    </div>;
  };
  return <div className="tool-panel attention-inbox">
    <div className="tool-panel-heading"><AlertCircle /><div>
      <h3>Needs your attention</h3><p>{connection.name} · {connection.kind} · {connection.host || connection.distro || "Local desktop"} · represented inventory only</p>
    </div></div>
    <label className="checkbox-label"><input type="checkbox" checked={notifications}
      onChange={(e) => onNotifications(e.target.checked)} />Windows notifications when a seat newly needs input</label>
    <p>{scope.reason}</p>
    {refusal && <ErrorBox error={refusal} />}
    <h4>{inventory && !scope.ready ? "Last known needs input" : "Needs input"}{inventory ? ` (${seats.length})` : ""}</h4>
    {inventory && scope.ready && !seats.length && <Empty icon={<Check size={28} />} title="No seats need input" description={`No seats in the represented inventory for ${connection.name} are marked as needing input. Sidebar filters do not hide seats here.`} />}
    {seats.map((seat, index) => row(seat, index))}
    <h4>Seat problems</h4>
    {inventory && !problems.length && <p>No failed-seat diagnostics in the available represented inventory.</p>}
    {problems.map((seat, index) => row(seat, index, true))}
    <h4>Blocked work</h4>
    {ownedError && <ErrorBox error={`Could not load blocked work for ${connection.name}: ${ownedError}. Check this connection using the existing connection controls.`} />}
    {ownedBlocked === null && !ownedError && <Loading text="Checking blocked work" />}
    {ownedBlocked !== null && !ownedBlocked.length && !ownedError && <p>{`No blocked or failed work was reported for ${connection.name}.`}</p>}
    {(ownedBlocked || []).map((item, index) => <div className="attention-row" key={`${String(item.id)}:${index}`}>
      <StatusDot status="attention" /><section><strong>{String(item.title || "Work title unavailable")}</strong>
      <p>{String(item.destination || "Destination unavailable")} · {String(item.status)}</p></section>
    </div>)}
  </div>;
}
export function ProjectTools({
  connection,
  root,
  onFile,
  onChanged,
}: {
  connection: Connection;
  root: string;
  onFile: (path: string, line?: number) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [path, setPath] = useState("");
  const [destination, setDestination] = useState("");
  const action = async (request: any) => {
    setError("");
    setBusy(true);
    try {
      const result = await window.hrig.edit(connection, { ...request, root });
      if (request.op === "searchText") setMatches(result);
      else {
        onChanged();
        if (request.op === "create") onFile(request.path);
        if (request.op === "rename") onFile(request.destination);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <FileSearch />
        <div>
          <h3>Project tools</h3>
          <p>Search text, create files, and rename project entries.</p>
        </div>
      </div>
      <label className="field-label">
        SEARCH PROJECT CONTENTS
        <div className="input-with-button">
          <input
            aria-label="Project text search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query)
                action({ op: "searchText", query });
            }}
            placeholder="Find text in this project…"
          />
          <button
            className="primary-button"
            disabled={busy || !query}
            onClick={() => action({ op: "searchText", query })}
          >
            Search text
          </button>
        </div>
      </label>
      <p className="field-note">
        Literal, case-insensitive search. Up to 200 matches across 20,000 files;
        dependencies and binaries are excluded.
      </p>
      {error && <ErrorBox error={error} />}
      <div className="search-results">
        {matches.map((m, i) => (
          <button key={i} onClick={() => onFile(m.path, m.line)}>
            <strong>
              {m.path}:{m.line}
            </strong>
            <code>{m.text}</code>
          </button>
        ))}
      </div>
      <div className="tool-panel-heading">
        <FilePlus size={18} />
        <div>
          <h3>New file</h3>
        </div>
      </div>
      <div className="input-with-button">
        <input
          aria-label="New file path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="src/new-file.ts"
        />
        <button
          className="secondary-button"
          disabled={busy || !path}
          onClick={() => action({ op: "create", path, content: "" })}
        >
          Create file
        </button>
      </div>
      <div className="tool-panel-heading">
        <FolderPen size={18} />
        <div>
          <h3>Rename / move</h3>
          <p>Save and close editors for the old path first.</p>
        </div>
      </div>
      <label className="field-label">
        EXISTING PATH
        <input
          aria-label="Existing file path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </label>
      <label className="field-label">
        NEW PATH
        <input
          aria-label="Rename destination"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
      </label>
      <button
        className="secondary-button"
        disabled={busy || !path || !destination}
        onClick={() => action({ op: "rename", path, destination })}
      >
        Rename entry
      </button>
    </div>
  );
}
export function PreviewPanel({ config }: { config: PanelConfig }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setUrl("");
    window.hrig
      .openPreview(config.connection, config.port!)
      .then((r) => {
        if (active) setUrl(r.url);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [config.connection.id, config.port, reload]);
  return (
    <div className="preview-panel">
      <div className="editor-toolbar">
        <span>
          <Globe size={14} />
          {url || "Connecting preview…"}
        </span>
        <button
          className="small-button"
          onClick={() => {
            setError("");
            setReload((n) => n + 1);
          }}
        >
          Reload preview
        </button>
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : url ? (
        <iframe
          title={`Preview port ${config.port}`}
          key={reload}
          src={url}
          sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"
        />
      ) : (
        <Loading text="Preparing preview connection…" />
      )}
    </div>
  );
}
export function PortsPanel({
  connection,
  onPreview,
}: {
  connection: Connection;
  onPreview: (port: number) => void;
}) {
  const [ports, setPorts] = useState<{ port: number }[]>([]);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    window.hrig
      .ports(connection)
      .then((r) => {
        if (active) {
          setPorts(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [connection.id, refresh]);
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <Globe />
        <div>
          <h3>Ports and previews</h3>
          <p>
            SSH previews use managed loopback-only tunnels. WSL uses localhost
            forwarding.
          </p>
        </div>
        <button
          className="small-button"
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh ports
        </button>
      </div>
      <div className="input-with-button">
        <input
          type="number"
          min="1"
          max="65535"
          aria-label="Preview port"
          placeholder="3000"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button
          className="primary-button"
          disabled={!Number(manual) || Number(manual) > 65535}
          onClick={() => onPreview(Number(manual))}
        >
          Open preview
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      <div className="ports-list">
        {ports.map((p) => (
          <div key={p.port}>
            <span>:{p.port}</span>
            <button className="small-button" onClick={() => onPreview(p.port)}>
              Preview
            </button>
            <button
              className="small-button"
              onClick={() =>
                window.hrig
                  .closePreview(connection, p.port)
                  .then(() => setRefresh((n) => n + 1))
              }
            >
              Close SSH tunnel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
export function RigManager({
  connection,
  root,
  inventory,
  onChanged,
  onSeat,
  onDeleted,
}: {
  connection: Connection;
  root: string;
  inventory: Inventory | null;
  onChanged: () => void;
  onSeat: (seat: Seat) => void;
  onDeleted: (id: string) => void;
}) {
  const [designer, setDesigner] = useState(false);
  const [deleting, setDeleting] = useState<Inventory["rigs"][number] | null>(
    null,
  );
  const [specs, setSpecs] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [operation, setOperation] = useState<"start" | "stop">("start");
  useEffect(() => {
    let active = true;
    window.hrig
      .rigAction(connection, { op: "specs" })
      .then((r) => {
        if (active) setSpecs(Array.isArray(r) ? r : r.entries || r.items || []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [connection.id]);
  const change = (value: string, isExisting: boolean) => {
    setName(value);
    setExisting(isExisting);
    setPlan(null);
    setConfirmation("");
    setResult(null);
    setError("");
  };
  const run = async (op: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await window.hrig.rigAction(connection, {
        op,
        name,
        root,
        existing,
        confirmation,
      });
      if (op === "plan") setPlan({ name, root, existing, result: r });
      else {
        setResult(r);
        setPlan(null);
        setConfirmation("");
        onChanged();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <Play />
        <div>
          <h3>Rig manager</h3>
          <p>
            OpenRig performs lifecycle operations. HRig never launches from
            layout restoration.
          </p>
        </div>
      </div>
      <button
        className="primary-button"
        disabled={connection.kind === "local" || !!deleting}
        onClick={() => setDesigner((v) => !v)}
      >
        {designer ? "Close rig designer" : "Design a new rig"}
      </button>
      {designer && (
        <RigDesigner
          connection={connection}
          root={root}
          onChanged={onChanged}
        />
      )}
      {deleting && (
        <DeleteRig
          key={deleting.id}
          connection={connection}
          rig={deleting}
          seats={inventory?.seats.filter((s) => s.rigId === deleting.id) || []}
          onCancel={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            change("", false);
            onChanged();
            setResult({ deleted: true, name: deleting.name });
            onDeleted(deleting.id);
          }}
        />
      )}
      <div className="topology-list">
        {inventory?.rigs.map((r) => (
          <div key={r.id}>
            <button
              className="rig-topology-heading"
              onClick={() => change(r.name, true)}
            >
              <StatusDot status={r.status} />
              <strong>{r.name}</strong>
              <span>
                {r.status} · {r.nodeCount} seats
              </span>
            </button>
            <button
              className="small-button danger"
              disabled={!!deleting}
              onClick={() => {
                setDesigner(false);
                setDeleting(r);
              }}
            >
              Delete {r.name}
            </button>
            <div className="topology-seats">
              {inventory.seats
                .filter((s) => s.rigId === r.id)
                .map((s) => (
                  <button key={s.id} onClick={() => onSeat(s)}>
                    <StatusDot status={s.status} />
                    <span>
                      {s.pod ? s.pod + " / " : ""}
                      {s.name}
                    </span>
                    <small>{s.runtime}</small>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <label className="field-label">
        LIBRARY RIG SPEC
        <select
          aria-label="Rig spec"
          value={existing ? "" : name}
          onChange={(e) => change(e.target.value, false)}
        >
          <option value="">Select a rig specification…</option>
          {specs
            .filter((s) => !s.kind || s.kind === "rig")
            .map((s, i) => (
              <option key={s.id || i} value={s.name || s.id}>
                {s.name || s.id}
              </option>
            ))}
        </select>
      </label>
      <label className="field-label">
        RIG / SPEC NAME
        <input
          aria-label="Rig name"
          value={name}
          onChange={(e) => change(e.target.value, existing)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={existing}
          onChange={(e) => change(name, e.target.checked)}
        />
        Restore an existing rig by name
      </label>
      <div className="arrange-controls">
        <button
          className="secondary-button"
          disabled={!name || busy}
          onClick={() => {
            setOperation("start");
            run("plan");
          }}
        >
          Preview {existing ? "restore" : "launch"}
        </button>
        <button
          className="secondary-button danger"
          disabled={!name || !existing || busy}
          onClick={() => {
            setOperation("stop");
            setConfirmation("");
            setPlan({
              name,
              root,
              existing,
              result: {
                action: "Stop rig and snapshot",
                rig: name,
                seats: inventory?.seats
                  .filter((s) => s.rigName === name)
                  .map((s) => s.name),
              },
            });
          }}
        >
          Prepare stop + snapshot
        </button>
      </div>
      {error && <ErrorBox error={error} />}{" "}
      {plan && (
        <div className="operation-confirm">
          <h3>
            {operation === "stop"
              ? "Stop rig and save snapshot"
              : "Previewed launch / restore"}
          </h3>
          <pre>{JSON.stringify(plan.result, null, 2)}</pre>
          <label className="field-label">
            TYPE {name} TO CONFIRM
            <input
              aria-label="Confirm rig name"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            className="primary-button"
            disabled={
              busy ||
              confirmation !== name ||
              plan.name !== name ||
              plan.root !== root ||
              plan.existing !== existing
            }
            onClick={() => run(operation)}
          >
            {busy
              ? "Running…"
              : operation === "stop"
                ? "Stop rig + snapshot"
                : "Confirm launch / restore"}
          </button>
        </div>
      )}
      {result && (
        <pre className="json-result">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
