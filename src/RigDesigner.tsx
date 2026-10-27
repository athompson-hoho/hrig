import { useEffect, useState } from "react";
import {
  Code2,
  Search,
  ScanSearch,
  Palette,
  UserRound,
  Users,
  Network,
  Check,
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  Cpu,
  Rocket,
  CheckCircle2,
} from "lucide-react";
import type { Connection, Rig, Seat as RigSeat } from "./types";
import { useSettings } from "./SettingsContext";
import { ErrorBox, Loading } from "./components";

type Agent = { id: string; name: string; summary?: string };
type Seat = { id: string; agentId: string; runtime: string };
const goals = {
  build: {
    label: "Build or change software",
    roles: ["implementer", "reviewer", "qa", "orchestrator"],
    why: "An implementer owns the changes. A reviewer provides an independent check; a larger team adds QA and coordination.",
  },
  research: {
    label: "Research and plan",
    roles: ["researcher", "reviewer", "planner", "orchestrator"],
    why: "A researcher gathers evidence. A reviewer challenges conclusions; a larger team adds planning and coordination.",
  },
  review: {
    label: "Review or troubleshoot",
    roles: ["reviewer", "implementer", "qa", "orchestrator"],
    why: "A reviewer investigates first. Add an implementer for fixes and QA for reproduction and verification.",
  },
  design: {
    label: "Design a product or interface",
    roles: ["product-designer", "implementer", "reviewer", "qa"],
    why: "A designer shapes the experience. Additional seats implement, review, and verify it.",
  },
};
export function DeleteRig({
  connection,
  rig,
  seats,
  onDone,
  onCancel,
}: {
  connection: Connection;
  rig: Rig;
  seats: RigSeat[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="operation-confirm" aria-label="Delete rig confirmation">
      <h3>Delete {rig.name}?</h3>
      <p>
        This stops its managed seats and removes the rig record. Work in
        progress stops. You cannot restore this rig by name afterward. OpenRig
        will attempt a snapshot first and can block deletion if teardown fails.
      </p>
      <p>
        Rig ID: <code>{rig.id}</code>
      </p>
      <p>
        Affected seats: {seats.map((s) => s.name).join(", ") || "None reported"}
        .
      </p>
      <p>
        Project files are not deleted. This action does not delete the library
        specification.
      </p>
      <label className="field-label">
        TYPE {rig.name} TO DELETE
        <input
          aria-label="Confirm deletion name"
          value={confirmation}
          disabled={busy}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      {error && <ErrorBox error={error} />}
      <div className="arrange-controls">
        <button className="secondary-button" disabled={busy} onClick={onCancel}>
          Cancel deletion
        </button>
        <button
          className="primary-button danger"
          disabled={busy || confirmation !== rig.name}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await window.hrig.rigAction(connection, {
                op: "delete",
                name: rig.name,
                id: rig.id,
                confirmation,
              });
              onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting..." : "Delete rig permanently"}
        </button>
      </div>
    </section>
  );
}
export default function RigDesigner({
  connection,
  root,
  onChanged,
}: {
  connection: Connection;
  root: string;
  onChanged: () => void;
}) {
  const { effective: preferences } = useSettings();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState<keyof typeof goals>("build");
  const [size, setSize] = useState(preferences["rig.defaultTeamSize"]);
  const [runtime, setRuntime] = useState(preferences["rig.defaultRuntime"]);
  const [folder, setFolder] = useState(root);
  const [folders, setFolders] = useState<
    Awaited<ReturnType<typeof window.hrig.projects>>
  >([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof window.hrig.designRig>
  > | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [launched, setLaunched] = useState(false);
  const [previewToken, setPreviewToken] = useState("");
  const [designId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    window.hrig
      .rigAction(connection, { op: "agents" })
      .then((r) => {
        if (active)
          setAgents(Array.isArray(r) ? r : r.entries || r.items || []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    window.hrig
      .projects(connection)
      .then((r) => {
        if (active) setFolders(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [connection]);
  const recommend = () => {
    setSeats(
      goals[kind].roles.slice(0, size).map((id) => {
        const exact = agents.find((a) => a.name.toLowerCase() === id);
        const matching = agents.find((a) => a.name.toLowerCase().includes(id));
        return { id, agentId: (exact || matching)?.id || "", runtime };
      }),
    );
    setStep(1);
    setError("");
    setPreview(null);
  };
  const run = async (op: "preview" | "launch") => {
    setBusy(true);
    setError("");
    try {
      const result = await window.hrig.designRig(connection, {
        op,
        name,
        goal,
        root: folder,
        seats,
        confirmation,
        previewToken,
        designId,
      });
      setPreviewToken(result.previewToken);
      setPreview(result);
      if (op === "launch") {
        setLaunched(true);
        setConfirmation("");
        onChanged();
      }
    } catch (e) {
      setError((e as Error).message);
      if (op === "preview") setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading text="Loading installed agents..." />;
  return (
    <section className="rig-designer" aria-label="Rig designer">
      <header className="designer-header">
        <div className="designer-mark">
          <Network size={17} />
        </div>
        <div>
          <h3>Rig designer</h3>
          <p>Configure a team for your project.</p>
        </div>
        <span className="designer-host">{connection.name}</span>
      </header>
      <ol className="designer-steps" aria-label="Design progress">
        {["Needs", "Seats", "Review"].map((label, i) => (
          <li
            key={label}
            className={step === i ? "current" : step > i ? "complete" : ""}
            aria-current={step === i ? "step" : undefined}
          >
            <span>{step > i ? <Check size={14} /> : i + 1}</span>
            <div>
              <strong>{label}</strong>
            </div>
          </li>
        ))}
      </ol>
      {step === 0 && (
        <div className="designer-body designer-needs">
          <div className="designer-section-heading">
            <h4>Project and goal</h4>
            <p>Choose the work, team size, and project folder.</p>
          </div>
          <div className="designer-intent-fields">
            <div>
              <label className="field-label">
                RIG NAME
                <input
                  aria-label="New rig name"
                  value={name}
                  maxLength={48}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-project-team"
                />
              </label>
              <p className="field-note">
                Start with a lowercase letter. Use up to 48 lowercase letters,
                digits or hyphens.
              </p>
            </div>
            <label className="field-label">
              GOAL
              <textarea
                aria-label="Rig goal"
                value={goal}
                maxLength={4000}
                rows={3}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Describe the outcome and constraints."
              />
            </label>
          </div>
          <fieldset className="designer-choice-group">
            <legend>Type of work</legend>
            <div className="designer-work-options">
              {Object.entries(goals).map(([id, g], i) => {
                const Icon = [Code2, Search, ScanSearch, Palette][i];
                return (
                  <label
                    key={id}
                    className={
                      kind === id
                        ? "designer-option selected"
                        : "designer-option"
                    }
                  >
                    <input
                      type="radio"
                      name={designId + "-work"}
                      checked={kind === id}
                      onChange={() => setKind(id as keyof typeof goals)}
                      value={id}
                    />
                    <Icon size={16} />
                    <strong>{g.label}</strong>
                    <span>
                      {
                        [
                          "Implement features and ship changes",
                          "Gather evidence and explore options",
                          "Find issues and verify the fixes",
                          "Shape the experience and interface",
                        ][i]
                      }
                    </span>
                    {kind === id && (
                      <Check className="option-check" size={14} />
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="designer-choice-group">
            <legend>How big should the team be?</legend>
            <div className="designer-team-options">
              {[
                {
                  value: 1,
                  title: "Solo",
                  text: "One focused owner. Lowest usage.",
                  icon: UserRound,
                },
                {
                  value: 2,
                  title: "Pair",
                  text: "An owner and an independent check.",
                  icon: Users,
                },
                {
                  value: 4,
                  title: "Team",
                  text: "Specialists working together.",
                  icon: Network,
                },
              ].map((choice) => (
                <label
                  key={choice.value}
                  className={
                    size === choice.value
                      ? "designer-option selected"
                      : "designer-option"
                  }
                >
                  <input
                    type="radio"
                    name={designId + "-size"}
                    checked={size === choice.value}
                    onChange={() => setSize(choice.value)}
                  />
                  <choice.icon size={16} />
                  <strong>
                    {choice.title}
                    {choice.value === 2 && <em>Recommended</em>}
                  </strong>
                  <span>{choice.text}</span>
                  <small>
                    {choice.value} {choice.value === 1 ? "seat" : "seats"}
                  </small>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="field-note">
            More seats increase model usage and coordination. A pair is a good
            starting point for work that benefits from independent review.
          </p>
          <div className="designer-project-settings">
            <label className="field-label">
              DEFAULT RUNTIME
              <select
                aria-label="Default runtime"
                value={runtime}
                onChange={(e) => setRuntime(e.target.value)}
              >
                <option value="codex">Codex</option>
                <option value="claude-code">Claude Code</option>
              </select>
            </label>
            {!!folders.length && (
              <label className="field-label">
                ATTACHED PROJECT
                <select
                  aria-label="Designer attached project"
                  value={folders.some((f) => f.path === folder) ? folder : ""}
                  onChange={(e) => {
                    if (e.target.value) setFolder(e.target.value);
                  }}
                >
                  <option value="">Choose a live rig folder</option>
                  {folders.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.path} ({f.rigs.map((r) => r.name).join(", ")})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field-label">
              PROJECT FOLDER
              <input
                aria-label="Designer project folder"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              />
            </label>
          </div>
          {!agents.length && (
            <p>
              No installed agents were found. Add agent specifications to
              OpenRig, then reopen the designer.
            </p>
          )}
          <button
            className="primary-button"
            disabled={
              !/^[a-z][a-z0-9-]{0,47}$/.test(name) ||
              !goal.trim() ||
              !folder.trim() ||
              !agents.length
            }
            onClick={recommend}
          >
            Recommend a team <ArrowRight size={15} />
          </button>
        </div>
      )}
      {step === 1 && (
        <div className="designer-body">
          <div className="designer-section-heading">
            <h4>Recommended seats</h4>
            <p>{goals[kind].why}</p>
          </div>
          <p className="field-note">
            Recommendations match installed agent names. Choose a suitable agent
            wherever there is no match. Runtime authentication and permissions
            are checked by OpenRig before launch.
          </p>
          <div className="designer-seats-grid">
            {seats.map((s, i) => (
              <div className="designer-seat" key={i}>
                <div className="designer-seat-heading">
                  <span>
                    <Users size={17} />
                  </span>
                  <strong>Seat {String(i + 1).padStart(2, "0")}</strong>
                  <small>
                    {s.runtime === "codex" ? "Codex" : "Claude Code"}
                  </small>
                </div>
                <label className="field-label">
                  SEAT {i + 1} NAME
                  <input
                    aria-label={`Seat ${i + 1} name`}
                    value={s.id}
                    onChange={(e) =>
                      setSeats((rows) =>
                        rows.map((row, j) =>
                          j === i ? { ...row, id: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  AGENT
                  <select
                    aria-label={`Seat ${i + 1} agent`}
                    value={s.agentId}
                    onChange={(e) =>
                      setSeats((rows) =>
                        rows.map((row, j) =>
                          j === i ? { ...row, agentId: e.target.value } : row,
                        ),
                      )
                    }
                  >
                    <option value="">Choose an installed agent</option>
                    {agents.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p>{agents.find((a) => a.id === s.agentId)?.summary}</p>
                <label className="field-label">
                  RUNTIME
                  <select
                    aria-label={`Seat ${i + 1} runtime`}
                    value={s.runtime}
                    onChange={(e) =>
                      setSeats((rows) =>
                        rows.map((row, j) =>
                          j === i ? { ...row, runtime: e.target.value } : row,
                        ),
                      )
                    }
                  >
                    <option value="codex">Codex</option>
                    <option value="claude-code">Claude Code</option>
                  </select>
                </label>
              </div>
            ))}
          </div>
          <div className="arrange-controls designer-footer">
            <button className="secondary-button" onClick={() => setStep(0)}>
              <ArrowLeft size={14} /> Back to needs
            </button>
            <button
              className="primary-button"
              disabled={
                seats.some(
                  (s) => !s.agentId || !/^[a-z][a-z0-9-]{0,31}$/.test(s.id),
                ) || new Set(seats.map((s) => s.id)).size !== seats.length
              }
              onClick={() => {
                setStep(2);
                setPreview(null);
                setError("");
              }}
            >
              Review design <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="designer-body">
          <div className="designer-section-heading">
            <h4>{launched ? "Rig launched" : "Review rig"}</h4>
            <p>Check the configuration, then preview it before launch.</p>
          </div>
          <div className="designer-review-card">
            <div className="designer-review-title">
              <span className="designer-mark">
                <Network size={17} />
              </span>
              <div>
                <h4>{name}</h4>
                <span>{goals[kind].label}</span>
              </div>
              <span className="designer-count">
                {seats.length} {seats.length === 1 ? "seat" : "seats"}
              </span>
            </div>
            <p>{goal}</p>
            <div className="designer-project-path">
              <FolderOpen size={16} />
              <code>{folder}</code>
            </div>
            <div className="designer-roster">
              {seats.map((s) => (
                <div key={s.id}>
                  <span className="designer-avatar">
                    {s.id.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{s.id}</strong>
                    <small>
                      {agents.find((a) => a.id === s.agentId)?.name}
                    </small>
                  </div>
                  <span>
                    <Cpu size={12} />
                    {s.runtime === "codex" ? "Codex" : "Claude Code"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p>
            The team shares this project folder and has collaboration links from
            the first seat to the others. The goal becomes the rig summary; send
            a task after launch when you are ready to begin.
          </p>
          <p className="field-note">
            Saving writes hrig-{name}.yaml to the project. Existing files are
            preserved. OpenRig validates the spec and previews launch without
            starting seats. Default agent profiles and model settings are
            inherited.
          </p>
          {!launched && (
            <div className="arrange-controls">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setStep(1);
                  setPreview(null);
                  setConfirmation("");
                }}
              >
                <ArrowLeft size={14} /> Back to team
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => run("preview")}
              >
                {busy ? "Working..." : "Save and preview design"}
              </button>
            </div>
          )}
          {preview && (
            <>
              <div className="designer-preview-ready">
                <CheckCircle2 size={18} />
                <div>
                  <strong>
                    {launched ? "Launch complete" : "Preview ready"}
                  </strong>
                  <small>Saved to {preview.path}</small>
                </div>
              </div>
              <details>
                <summary>Rig specification</summary>
                <pre className="json-result">
                  {JSON.stringify(preview.spec, null, 2)}
                </pre>
              </details>
              <details className="designer-plan-details">
                <summary>OpenRig preview details</summary>
                <pre className="json-result">
                  {JSON.stringify(preview.result, null, 2)}
                </pre>
              </details>
              {!!preview.result?.warnings?.length && (
                <div className="designer-warnings">
                  <strong>Before you launch</strong>
                  <ul>
                    {preview.result.warnings.map((w: unknown, i: number) => (
                      <li key={i}>
                        {typeof w === "string" ? w : JSON.stringify(w)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!launched && (
                <div className="operation-confirm">
                  <label className="field-label">
                    TYPE {name} TO LAUNCH
                    <input
                      aria-label="Confirm new rig name"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={busy || confirmation !== name}
                    onClick={() => run("launch")}
                  >
                    <Rocket size={15} /> Launch designed rig
                  </button>
                </div>
              )}
            </>
          )}
          {launched && (
            <p role="status">
              Rig launched. Its seats will appear in the rig manager and session
              list.
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="designer-error">
          <ErrorBox error={error} />
        </div>
      )}
    </section>
  );
}
