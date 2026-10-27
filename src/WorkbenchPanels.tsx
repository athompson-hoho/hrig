import { useEffect, useState } from "react";
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
export function DoctorPanel({ connection }: { connection: Connection }) {
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setReport(null);
    window.hrig
      .doctor(connection)
      .then((r) => {
        if (active) setReport(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [connection.id, revision]);
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <Network />
        <div>
          <h3>Connection doctor</h3>
          <p>{connection.name} · checks the actual login environment</p>
        </div>
        <button
          className="small-button"
          onClick={() => {
            setError("");
            setRevision((n) => n + 1);
          }}
        >
          <RefreshCw size={13} />
          Run checks
        </button>
      </div>
      {error && <ErrorBox error={error} />}{" "}
      {!report ? (
        <Loading text="Checking connection and dependencies…" />
      ) : (
        <>
          <div
            className={`diagnostic-summary ${report.healthy ? "good" : "warning"}`}
          >
            {report.healthy ? <Check size={17} /> : <AlertCircle size={17} />}{" "}
            {report.healthy
              ? "Connection is ready"
              : "Some checks need attention"}
          </div>
          {report.checks.map((check: any) => (
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
      )}
    </div>
  );
}
export function AttentionPanel({
  connection,
  inventory,
  onSeat,
  notifications,
  onNotifications,
}: {
  connection: Connection;
  inventory: Inventory | null;
  onSeat: (seat: Seat) => void;
  notifications: boolean;
  onNotifications: (value: boolean) => void;
}) {
  const [blocked, setBlocked] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
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
  }, [connection.id]);
  const seats =
    inventory?.seats.filter(
      (s) => s.status === "attention" || (s.status === "failed" && s.error),
    ) || [];
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <AlertCircle />
        <div>
          <h3>Needs your attention</h3>
          <p>Reported seat problems and blocked work; no inferred urgency.</p>
        </div>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={notifications}
          onChange={(e) => onNotifications(e.target.checked)}
        />
        Windows notifications when a seat newly needs input
      </label>
      {error && <ErrorBox error={error} />}{" "}
      {!seats.length && !blocked.length && !error && (
        <Empty
          icon={<Check size={28} />}
          title="Nothing needs your attention"
          description="Seats needing input and blocked tasks will appear here."
        />
      )}
      {seats.map((seat) => (
        <button
          className="attention-row"
          key={seat.id}
          onClick={() => onSeat(seat)}
        >
          <StatusDot status="attention" />
          <section>
            <strong>
              {seat.name}@{seat.rigName}
            </strong>
            <p>
              {seat.error ||
                seat.activity ||
                "OpenRig reports that this seat needs attention."}
            </p>
          </section>
          <span>Open seat →</span>
        </button>
      ))}
      {blocked.map((item) => (
        <div className="attention-row" key={String(item.id)}>
          <StatusDot status="attention" />
          <section>
            <strong>{String(item.title)}</strong>
            <p>
              {String(item.destination)} · {String(item.status)}
            </p>
          </section>
        </div>
      ))}
    </div>
  );
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
}: {
  connection: Connection;
  root: string;
  inventory: Inventory | null;
  onChanged: () => void;
  onSeat: (seat: Seat) => void;
}) {
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
