import { useEffect, useRef, useState } from "react";
import type { Connection, Inventory, PanelConfig } from "./types";
import type { CommandSchema, ControlResult } from "./rig-control-types";
import { ErrorBox, Loading } from "./components";
import TerminalPanel from "./TerminalPanel";
import RigCommandResult from "./RigCommandResult";
import index from "./openrig-command-index.json";

const human = (value: string) =>
  value
    .replace(/^--?/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ");
const secret = (name: string) =>
  /password|secret|token|credential|api[-_]?key/i.test(name);
const category = (name: string) => {
  if (
    "start status snapshot restore export import bootstrap requirements up down archive unarchive ps expand add create grow launch remove shrink restore-check restore-packet"
      .split(" ")
      .includes(name)
  )
    return "Rigs and lifecycle";
  if (
    "parked discover attach bind adopt roster transcript send capture broadcast walk ask fork reconcile-session unclaim release compact-plan compact seat handover whoami terminal tui"
      .split(" ")
      .includes(name)
  )
    return "Seats and conversations";
  if (
    "stream queue project view watchdog workflow chatroom heartbeat scope proof startup-proof"
      .split(" ")
      .includes(name)
  )
    return "Work and coordination";
  if (
    "agent spec specs context bundle package plugin skill agent-image community-harness workspace"
      .split(" ")
      .includes(name)
  )
    return "Library and workspace";
  if ("auth provider usage policy mode".split(" ").includes(name))
    return "Accounts and permissions";
  return "Hosts, integrations and recovery";
};
export default function RigControl({
  connection,
  root,
  inventory,
  onFile,
}: {
  connection: Connection;
  root: string;
  inventory: Inventory | null;
  onFile: (path: string, line?: number) => void;
}) {
  const [path, setPath] = useState<string[]>([]);
  const [schema, setSchema] = useState<CommandSchema | null>(null);
  const [rootCommands, setRootCommands] = useState<CommandSchema["commands"]>(
    [],
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [values, setValues] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<
    Record<string, { enabled: boolean; value: string; repeat: boolean }>
  >({});
  const [mode, setMode] = useState("capture");
  const [plan, setPlan] = useState<ControlResult | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [output, setOutput] = useState("");
  const [warnings, setWarnings] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [terminal, setTerminal] = useState<PanelConfig | null>(null);
  const pathKey = JSON.stringify(path);
  const scope = JSON.stringify([connection, root, path, values, options, mode]);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  useEffect(() => {
    setPlan(null);
    setConfirmation("");
  }, [scope]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSchema(null);
    setError("");
    setValues({});
    setOptions({});
    setPlan(null);
    setOutput("");
    setWarnings("");
    setSearch("");
    setMode(
      [
        "tui",
        "mcp",
        "attach",
        "chatroom",
        "terminal",
        "ui",
        "walk",
        "compact",
        "handover",
      ].includes(path[0]) || /watch|tail|follow|login/.test(path.join(" "))
        ? "terminal"
        : "capture",
    );
    window.hrig
      .rigControl(connection, { op: "describe", path, refresh: !!revision })
      .then((result) => {
        if (!active) return;
        setSchema(result.schema!);
        setOptions(
          Object.fromEntries(
            result
              .schema!.options.filter((o) => o.mandatory)
              .map((o) => [
                o.flag,
                { enabled: true, value: "", repeat: false },
              ]),
          ),
        );
        if (!path.length) setRootCommands(result.schema!.commands);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connection, pathKey, revision]);
  useEffect(() => {
    setRootCommands([]);
    setPath([]);
    setTerminal(null);
  }, [connection]);
  useEffect(() => {
    const id = terminal?.terminalId;
    return () => {
      if (id) void window.hrig.closeTerminal(id).catch(() => {});
    };
  }, [terminal?.terminalId]);
  const choose = (next: string[]) => {
    setPath(next);
    setSearch("");
    setPlan(null);
    setConfirmation("");
  };
  function request() {
    return {
      path,
      root,
      mode,
      values: Object.fromEntries(
        (schema?.arguments || []).map((a) => [
          a.name,
          a.variadic
            ? (values[a.name] || "").split("\n").filter(Boolean)
            : values[a.name] || "",
        ]),
      ),
      options: Object.fromEntries(
        Object.entries(options)
          .filter(([, v]) => v.enabled)
          .map(([flag, v]) => {
            const field = schema!.options.find((o) => o.flag === flag)!;
            return [
              flag,
              !field.valueName || (!v.value && field.optionalValue)
                ? true
                : field.variadic || v.repeat
                  ? v.value.split("\n").filter(Boolean)
                  : v.value,
            ];
          }),
      ),
    };
  }
  async function prepare() {
    setBusy(true);
    setError("");
    setPlan(null);
    try {
      const result = await window.hrig.rigControl(connection, {
        op: "prepare",
        ...request(),
      });
      if (latestScope.current === scope) {
        setPlan(result);
        setConfirmation("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!plan) return;
    setBusy(true);
    setError("");
    const selected = plan;
    setOutput("");
    setWarnings("");
    setPlan(null);
    setConfirmation("");
    try {
      if (selected.mode === "terminal") {
        if (terminal)
          throw new Error(
            "Close the previous action terminal before starting another one.",
          );
        setTerminal({
          connection,
          root,
          terminalId: "rig-control-" + crypto.randomUUID(),
          rigControlToken: selected.token,
          rigControlConfirmation: confirmation,
          role: "rig " + path.join(" "),
        });
      } else {
        const result = await window.hrig.rigControl(connection, {
          op: "run",
          token: selected.token,
          confirmation,
        });
        if (latestScope.current === scope) {
          setOutput(result.output || "Command completed without output.");
          setWarnings(result.warnings || "");
        }
      }
    } catch (e) {
      setError(
        (e as Error).message +
          " The action may have started before the error. Check its state before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  const query = search.toLowerCase().trim();
  const indexed = query
    ? index.entries
        .filter((e) =>
          (e.path.join(" ") + " " + e.description)
            .toLowerCase()
            .includes(query),
        )
        .slice(0, 150)
    : [];
  const secretValues = new Set(
    [
      ...Object.entries(values)
        .filter(([name]) => secret(name))
        .map(([, value]) => value),
      ...Object.entries(options)
        .filter(([flag]) => secret(flag))
        .map(([, value]) => value.value),
    ].filter(Boolean),
  );
  const displayArgs = plan?.args?.map((arg) =>
    secretValues.has(arg)
      ? "[hidden]"
      : /^--[^=]*(?:password|secret|token|credential|api-key)[^=]*=/i.test(arg)
        ? arg.split("=")[0] + "=[hidden]"
        : arg,
  );
  return (
    <section
      className="tool-panel rig-control"
      aria-label="OpenRig control center"
    >
      <div className="tool-panel-heading">
        <div>
          <h3>OpenRig control center</h3>
          <p>
            Guided actions for {connection.name}. Fields and help come from this
            host’s installed CLI.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={busy || loading}
          title="Reload the installed command help; this does not execute an action"
          onClick={() => setRevision((n) => n + 1)}
        >
          Reload help
        </button>
      </div>
      <details>
        <summary title="How to choose a command, fill its form, and review its effect">
          How to use this control center
        </summary>
        <p>
          Search by task or command name, choose an action, and fill its
          arguments. Optional switches have checkboxes; expand a field’s help
          for details. Advanced operations retain their CLI names so you can
          follow OpenRig documentation.
        </p>
        <p>
          Review the host, target and options before running. Actions can start
          or stop agents, send messages, change accounts or remove data. Nothing
          runs merely by browsing. Use terminal mode for interactive prompts or
          continuous output; use captured output for commands that finish.
        </p>
        <p>
          Search suggestions were audited against OpenRig {index.version}.
          Selecting any suggestion verifies it against the current host.
          Unsupported commands show an error instead of running a substitute.
        </p>
      </details>
      <label className="field-label">
        FIND AN ACTION
        <input
          aria-label="Find OpenRig action"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Try snapshots, workflow, auth, scope, usage…"
          title="Search command paths and their descriptions"
        />
      </label>
      {query && (
        <div className="rig-command-list" aria-label="Command search results">
          {/help|version|about/.test(query) && (
            <button
              title="Open global options and exact installed help without executing anything"
              onClick={() => choose([])}
            >
              <strong>Help and version</strong>
              <span>Browse global options and the installed CLI help.</span>
            </button>
          )}
          {indexed.map((entry) => (
            <button
              key={entry.path.join(" ")}
              title={entry.description}
              onClick={() => choose(entry.path)}
            >
              <strong>{entry.path.join(" → ")}</strong>
              <span>{entry.description}</span>
            </button>
          ))}
          {!indexed.length && (
            <p>No matching actions. Browse the installed categories below.</p>
          )}
          {indexed.length === 150 && (
            <p>Showing the first 150 matches. Refine your search.</p>
          )}
        </div>
      )}
      <nav className="rig-breadcrumbs" aria-label="Command location">
        <button
          title="Browse all installed commands and global options"
          onClick={() => choose([])}
        >
          All commands
        </button>
        {path.map((part, i) => (
          <button
            key={i}
            title={`Open help and actions for rig ${path.slice(0, i + 1).join(" ")}`}
            onClick={() => choose(path.slice(0, i + 1))}
          >
            {human(part)}
          </button>
        ))}
      </nav>
      {loading ? (
        <Loading text="Reading installed command help…" />
      ) : (
        schema && (
          <>
            <h4>
              {path.length ? path.map(human).join(" → ") : "Installed commands"}
            </h4>
            <p>{schema.description}</p>
            {!path.length && (
              <label className="field-label">
                CATEGORY
                <select
                  aria-label="Command category"
                  title="Narrow installed actions by task area"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  {[
                    "All categories",
                    ...new Set(schema.commands.map((c) => category(c.name))),
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            )}
            {!!schema.commands.length && (
              <div className="rig-command-list" aria-label="Installed actions">
                {schema.commands
                  .filter(
                    (c) =>
                      path.length ||
                      categoryFilter === "All categories" ||
                      category(c.name) === categoryFilter,
                  )
                  .map((command) => (
                    <button
                      key={command.name}
                      title={`${command.description}\nrig ${[...path, command.signature].join(" ")}`}
                      onClick={() => choose([...path, command.name])}
                    >
                      <small>
                        {!path.length ? category(command.name) : "Action"}
                      </small>
                      <strong>{human(command.name)}</strong>
                      <span>{command.description}</span>
                    </button>
                  ))}
              </div>
            )}
            <details>
              <summary title="Exact help returned by the installed OpenRig command">
                Installed command help
              </summary>
              <pre className="rig-output">{schema.help}</pre>
            </details>
            <fieldset disabled={busy} className="rig-command-form">
              <legend>
                {path.length ? "Action inputs" : "Global options"}
              </legend>
              {schema.arguments.map((argument, i) => (
                <label className="field-label" key={argument.name}>
                  {human(argument.name)}{" "}
                  {argument.required ? "(required)" : "(optional)"}
                  {argument.variadic ||
                  /text|message|question|body|prompt|content/i.test(
                    argument.name,
                  ) ? (
                    <textarea
                      aria-label={argument.name}
                      aria-describedby={`rig-arg-${i}`}
                      title={argument.description}
                      rows={3}
                      value={values[argument.name] || ""}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [argument.name]: e.target.value,
                        }))
                      }
                      placeholder={
                        argument.variadic
                          ? "One value per line"
                          : "Enter text; line breaks are preserved"
                      }
                    />
                  ) : (
                    <input
                      aria-label={argument.name}
                      aria-describedby={`rig-arg-${i}`}
                      title={argument.description}
                      type={secret(argument.name) ? "password" : "text"}
                      list={
                        /session|seat/i.test(argument.name)
                          ? "rig-session-suggestions"
                          : /rig/i.test(argument.name)
                            ? "rig-id-suggestions"
                            : undefined
                      }
                      value={values[argument.name] || ""}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [argument.name]: e.target.value,
                        }))
                      }
                    />
                  )}
                  <span id={`rig-arg-${i}`} className="field-note">
                    {argument.description}
                    {argument.variadic && " Enter one value per line."}
                  </span>
                </label>
              ))}
              <datalist id="rig-id-suggestions">
                {inventory?.rigs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </datalist>
              <datalist id="rig-session-suggestions">
                {inventory?.seats
                  .filter((s) => s.session)
                  .map((s) => (
                    <option key={s.id} value={s.session!}>
                      {s.name}
                    </option>
                  ))}
              </datalist>
              {!!schema.options.length && (
                <details>
                  <summary title="Enable only the options needed for this action">
                    Options ({schema.options.length})
                  </summary>
                  {schema.options.map((option, i) => {
                    const state = options[option.flag] || {
                      enabled: !!option.mandatory,
                      value: "",
                      repeat: false,
                    };
                    const update = (patch: Partial<typeof state>) =>
                      setOptions((v) => ({
                        ...v,
                        [option.flag]: { ...state, ...patch },
                      }));
                    return (
                      <div className="rig-option" key={option.flag}>
                        <label title={option.description}>
                          <input
                            type="checkbox"
                            aria-label={`Enable ${option.flag}`}
                            disabled={!!option.mandatory}
                            checked={state.enabled}
                            onChange={(e) =>
                              update({ enabled: e.target.checked })
                            }
                          />{" "}
                          {human(option.flag)} <code>{option.signature}</code>
                          {option.inherited && <small> inherited</small>}
                        </label>
                        <details>
                          <summary title={option.description}>
                            Help for {option.flag}
                          </summary>
                          <p id={`rig-option-${i}`}>
                            {option.description ||
                              "See installed command help for accepted values."}
                          </p>
                        </details>
                        {option.valueName && state.enabled && (
                          <div className="field-label">
                            {human(option.valueName)}
                            {option.optionalValue &&
                              " (leave empty to enable without a value)"}
                            {secret(option.flag) ? (
                              <input
                                aria-label={`Value for ${option.flag}`}
                                type="password"
                                title={option.description}
                                value={state.value}
                                onChange={(e) =>
                                  update({ value: e.target.value })
                                }
                              />
                            ) : (
                              <textarea
                                aria-label={`Value for ${option.flag}`}
                                title={option.description}
                                rows={2}
                                value={state.value}
                                onChange={(e) =>
                                  update({ value: e.target.value })
                                }
                                placeholder={
                                  option.variadic || state.repeat
                                    ? "One value per line"
                                    : /cwd|workspace|root/.test(option.flag)
                                      ? root
                                      : option.valueName
                                }
                              />
                            )}
                            <span className="field-note">
                              {option.variadic
                                ? "One value per line."
                                : "Multiline text stays one value unless repeat is enabled."}
                            </span>
                            {!option.variadic && !secret(option.flag) && (
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`Repeat ${option.flag}`}
                                  checked={state.repeat}
                                  onChange={(e) =>
                                    update({ repeat: e.target.checked })
                                  }
                                />{" "}
                                Repeat this option for each line (only when
                                supported by its help)
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </details>
              )}
              <label title="Terminal mode supports prompts, interactive dashboards, and commands that keep running">
                <input
                  type="checkbox"
                  aria-label="Run in terminal"
                  checked={mode === "terminal"}
                  onChange={(e) =>
                    setMode(e.target.checked ? "terminal" : "capture")
                  }
                />{" "}
                Run in terminal (interactive or continuous)
              </label>
              <button
                className="primary-button"
                title="Validate fields against installed help and review the exact action before anything executes"
                onClick={prepare}
              >
                Review action
              </button>
            </fieldset>
            {plan && (
              <section
                className="rig-action-review"
                aria-label="Review OpenRig action"
              >
                <h4>Review action on {connection.name}</h4>
                <p>
                  Working folder: <code>{plan.root}</code>
                </p>
                <pre className="rig-output">
                  {JSON.stringify(["rig", ...(displayArgs || [])], null, 2)}
                </pre>
                <p>
                  {schema.description} Selected mode:{" "}
                  {plan.mode === "terminal"
                    ? "Interactive terminal"
                    : "Captured output (60-second limit)"}
                  . Review the target and enabled options. Closing a terminal
                  ends its command; detached daemon work may continue.
                </p>
                <label className="field-label">
                  TYPE {plan.confirmation} TO RUN
                  <input
                    aria-label="Confirm OpenRig action"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    title="Confirms only the exact reviewed action on the selected host; review expires after two minutes"
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    confirmation !== plan.confirmation ||
                    (plan.mode === "terminal" && !!terminal)
                  }
                  onClick={execute}
                  title="Execute this reviewed action once; HRig will not automatically retry it"
                >
                  Run reviewed action
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setPlan(null)}
                  title="Discard the review without executing anything"
                >
                  Cancel review
                </button>
              </section>
            )}
          </>
        )
      )}
      {busy && <Loading text="Waiting for OpenRig…" />}
      {error && <ErrorBox error={error} />}
      {warnings && (
        <section aria-label="OpenRig warnings" role="status">
          <h4>OpenRig notices</h4>
          <pre className="rig-output">{warnings}</pre>
        </section>
      )}
      {output && (
        <section aria-label="OpenRig result">
          <h4>Command result</h4>
          <RigCommandResult output={output} />
        </section>
      )}
      {terminal && (
        <section aria-label="OpenRig action terminal">
          <button
            className="secondary-button"
            title="Stop this terminal process; detached daemon work may continue"
            onClick={async () => {
              await window.hrig.closeTerminal(terminal.terminalId!);
              setTerminal(null);
            }}
          >
            Close action terminal
          </button>
          <div className="rig-action-terminal">
            <TerminalPanel config={terminal} onFile={onFile} />
          </div>
        </section>
      )}
      {!!rootCommands.length && (
        <p className="field-note">
          {rootCommands.length} top-level command families on this host. Global
          version is under All commands → Global options. Help never runs an
          operational action.
        </p>
      )}
    </section>
  );
}
