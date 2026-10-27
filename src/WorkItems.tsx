import { useEffect, useRef, useState } from "react";
import type { Connection, Seat } from "./types";
import { draftKey, useDraft } from "./drafts";
import { ErrorBox, Modal } from "./components";
type Item = {
  id: string;
  title: string;
  body: string;
  status: string;
  url: string;
  project?: string;
  assignee?: string;
  team?: string;
};
export default function WorkItems({
  connection,
  root,
  seats,
}: {
  connection: Connection;
  root: string;
  seats: Seat[];
}) {
  const [config, setConfig, storageError] = useDraft(
    draftKey("board", connection, root),
    "board",
    {
      provider: "local",
      repo: "",
      owner: "",
      number: "",
      team: "",
      project: "",
      localItems: [] as Item[],
      links: {} as Record<string, string>,
    },
    { connection, root },
  );
  const { provider } = config;
  const [items, setItems] = useState<Item[]>([]),
    [statuses, setStatuses] = useState<{ id: string; name: string }[]>([]),
    [catalog, setCatalog] = useState<any>(null);
  const [partial, setPartial] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [filter, setFilter] = useState("");
  const [credential, setCredential] = useState(false),
    [secure, setSecure] = useState(false),
    [token, setToken] = useState("");
  const [selected, setSelected] = useState<Item | null>(null),
    [action, setAction] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [status, setStatus] = useState(""),
    [target, setTarget] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setItems([]);
    if (provider !== "linear") setCatalog(null);
    setSelected(null);
    setError("");
    setNotice("");
    setStatuses([]);
    setPartial(false);
  }, [
    provider,
    config.repo,
    config.owner,
    config.number,
    config.team,
    config.project,
  ]);
  useEffect(() => {
    window.hrig
      .integrate({ op: "credentials" })
      .then((r) => {
        setCredential(r.linear);
        setSecure(r.secureStorage);
      })
      .catch((e) => setError(e.message));
  }, []);
  const itemKey = (item: Item) =>
    JSON.stringify([
      provider,
      provider === "github" ? config.repo : "",
      provider === "projects" ? config.owner : "",
      provider === "projects" ? config.number : "",
      item.id,
    ]);
  const request = () => ({
    provider: provider === "projects" ? "github" : provider,
    repo: config.repo,
    owner: config.owner,
    number: config.number,
    team: config.team,
    project: config.project,
  });
  const load = async () => {
    const epoch = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let cat = catalog;
      if (provider === "linear") {
        cat = await window.hrig.integrate({
          provider: "linear",
          op: "catalog",
        });
        if (epoch === generation.current) setCatalog(cat);
      }
      const result = await window.hrig.integrate({
        ...request(),
        op: provider === "projects" ? "board" : "list",
      });
      if (epoch === generation.current) {
        setItems(result.items);
        setPartial(!!result.partial);
        setStatuses(
          result.statuses ||
            cat?.teams.nodes.flatMap((t: any) => t.states.nodes) ||
            [],
        );
        setNotice("Loaded " + new Date().toLocaleTimeString());
      }
    } catch (e) {
      if (epoch === generation.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "assign") {
        const seat = seats.find((s) => s.id === target);
        if (!seat)
          throw new Error(
            "Refresh the connection and choose an available seat.",
          );
        const receipt = await window.hrig.rigAction(connection, {
          op: "taskCreate",
          title: selected!.title,
          destination: seat.name + "@" + seat.rigName,
          body: [selected!.url, selected!.body].filter(Boolean).join("\n\n"),
        });
        const taskId =
          receipt?.qitemId ||
          receipt?.id ||
          receipt?.task?.id ||
          receipt?.task?.qitemId ||
          receipt?.item?.qitemId;
        if (!taskId || receipt?.errors?.length || receipt?.success === false)
          throw new Error(
            "OpenRig did not confirm a task identity. Check the task queue before trying again.",
          );
        setConfig((c) => ({
          ...c,
          links: {
            ...c.links,
            [itemKey(selected!)]: String(taskId),
          },
        }));
        setNotice(
          "Task accepted by OpenRig. The source issue status was not changed.",
        );
      } else if (provider === "local") {
        setConfig((c) => ({
          ...c,
          localItems:
            action === "create"
              ? [
                  ...c.localItems,
                  {
                    id: crypto.randomUUID(),
                    title,
                    body,
                    status: "Todo",
                    url: "",
                  },
                ]
              : action === "delete"
                ? c.localItems.filter((i) => i.id !== selected?.id)
                : c.localItems.map((i) =>
                    i.id === selected?.id
                      ? action === "edit"
                        ? { ...i, title, body }
                        : { ...i, status }
                      : i,
                  ),
        }));
        setNotice("Local board saved.");
      } else {
        await window.hrig.integrate({
          ...request(),
          op: action,
          confirmed: true,
          id: selected?.id,
          status,
          title,
          body,
        });
        await load();
        setNotice("Provider confirmed the change.");
      }
      setAction("");
      setSelected(null);
    } catch (e) {
      setError(
        (e as Error).message +
          " No automatic retry was made. Check the provider if the outcome is uncertain.",
      );
    } finally {
      setBusy(false);
    }
  };
  const displayed = (provider === "local" ? config.localItems : items).filter(
    (i) =>
      (i.title + " " + i.assignee + " " + i.project)
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const columns = Array.from(new Set(displayed.map((i) => i.status)));
  if (provider === "local")
    for (const name of ["Todo", "Doing", "Done"])
      if (!columns.includes(name)) columns.push(name);
  const change = (key: string, value: string) =>
    setConfig((c) => ({ ...c, [key]: value }));
  return (
    <div className="tool-panel work-items">
      <div className="tool-panel-heading">
        <div>
          <h3>Task boards and integrations</h3>
          <p>
            Project-scoped local boards, GitHub Issues/Projects and Linear.
            External changes and OpenRig assignments are deliberate actions.
          </p>
        </div>
      </div>
      {(error || storageError) && <ErrorBox error={error || storageError} />}
      {notice && (
        <p role="status" className="success-note">
          {notice}
        </p>
      )}
      <div className="form-grid">
        <label className="field-label">
          SOURCE
          <select
            aria-label="Task source"
            value={provider}
            disabled={busy}
            onChange={(e) => change("provider", e.target.value)}
          >
            <option value="local">Local project board</option>
            <option value="github">GitHub Issues</option>
            <option value="projects">GitHub Projects</option>
            <option value="linear">Linear</option>
          </select>
        </label>
        {provider === "github" && (
          <label className="field-label">
            REPOSITORY
            <input
              aria-label="GitHub repository"
              placeholder="owner/repository"
              value={config.repo}
              onChange={(e) => change("repo", e.target.value)}
            />
          </label>
        )}
        {provider === "projects" && (
          <>
            <label className="field-label">
              OWNER
              <input
                aria-label="GitHub project owner"
                value={config.owner}
                onChange={(e) => change("owner", e.target.value)}
              />
            </label>
            <label className="field-label">
              PROJECT NUMBER
              <input
                aria-label="GitHub project number"
                value={config.number}
                onChange={(e) => change("number", e.target.value)}
              />
            </label>
          </>
        )}
        {provider === "linear" && (
          <>
            <label className="field-label">
              TEAM
              <select
                aria-label="Linear team"
                value={config.team}
                onChange={(e) => change("team", e.target.value)}
              >
                <option value="">All teams (choose one to create)</option>
                {catalog?.teams.nodes.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              PROJECT
              <select
                aria-label="Linear project"
                value={config.project}
                onChange={(e) => change("project", e.target.value)}
              >
                <option value="">All projects</option>
                {catalog?.projects.nodes.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="arrange-controls">
        {provider !== "local" && (
          <button className="secondary-button" disabled={busy} onClick={load}>
            {busy ? "Loading…" : "Load / refresh board"}
          </button>
        )}
        {provider !== "projects" && (
          <button
            className="primary-button"
            disabled={
              busy || !!storageError || (provider === "linear" && !config.team)
            }
            onClick={() => {
              setAction("create");
              setSelected(null);
              setTitle("");
              setBody("");
            }}
          >
            New {provider === "local" ? "task" : "issue"}
          </button>
        )}
        <input
          aria-label="Filter board"
          placeholder="Filter title, project or assignee"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {partial && (
        <p role="status" className="editor-notice">
          Partial results: showing up to 100 items. Narrow the source or inspect
          the full board in the provider.
        </p>
      )}
      {provider === "projects" && (
        <p className="field-note">
          Project status columns are read-only in this release. GitHub CLI
          requires project read permission. Use GitHub Issues to create or close
          repository issues.
        </p>
      )}
      {(provider === "github" || provider === "projects") && (
        <p className="field-note">
          Uses your system GitHub CLI login (gh auth login). HRig does not copy
          its token into project settings. Run gh auth refresh -s read:project
          if Projects access is missing.
        </p>
      )}
      {provider === "linear" && (
        <details>
          <summary>
            Linear connection {credential ? "(connected)" : "(not connected)"}
          </summary>
          <p className="field-note">
            Personal API key stored with system encryption, outside project
            preferences and draft exports. Secure storage:{" "}
            {secure ? "available" : "unavailable"}. Only the fixed Linear API
            receives the key.
          </p>
          <input
            type="password"
            autoComplete="off"
            aria-label="Linear API key"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            disabled={busy || !token || !secure}
            onClick={async () => {
              setBusy(true);
              try {
                await window.hrig.integrate({
                  op: "connectLinear",
                  key: token,
                });
                setToken("");
                setCredential(true);
                setNotice("Linear connected.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Verify and connect Linear
          </button>
          <button
            disabled={busy || !credential}
            onClick={() => setAction("disconnect")}
          >
            Disconnect Linear
          </button>
        </details>
      )}
      {!displayed.length && (
        <p className="field-note">
          {provider === "local"
            ? "No tasks match. Create a task to start this project board."
            : "Load a board to view work, or adjust your filter. Errors and partial results are shown above."}
        </p>
      )}
      <div className="work-board">
        {columns.map((column) => (
          <section className="work-column" key={column}>
            <h4>
              {column}{" "}
              <small>
                {displayed.filter((i) => i.status === column).length}
              </small>
            </h4>
            {displayed
              .filter((i) => i.status === column)
              .map((item) => (
                <button
                  className="work-card"
                  key={item.id}
                  onClick={() => {
                    setSelected(item);
                    setAction("detail");
                    setStatus("");
                    setTarget(seats[0]?.id || "");
                  }}
                >
                  <strong>{item.title}</strong>
                  <small>
                    {item.project} {item.assignee}
                  </small>
                  {config.links[itemKey(item)] && (
                    <small>OpenRig: {config.links[itemKey(item)]}</small>
                  )}
                </button>
              ))}
          </section>
        ))}
      </div>
      {action && (
        <Modal
          title={
            action === "create"
              ? "Create " + (provider === "local" ? "local task" : "issue")
              : action === "disconnect"
                ? "Disconnect Linear?"
                : selected?.title || "Work item"
          }
          onClose={() => {
            if (!busy) {
              setAction("");
              setSelected(null);
            }
          }}
          wide
        >
          {action === "create" || action === "edit" ? (
            <>
              <label className="field-label">
                TITLE
                <input
                  aria-label="Issue title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={250}
                />
              </label>
              <label className="field-label">
                DESCRIPTION
                <textarea
                  aria-label="Issue description"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={50000}
                  rows={5}
                />
              </label>
              <p className="field-note">
                Create in {provider}: {config.repo || config.project || root}.
                No agent will be started or messaged.
              </p>
              <button
                className="primary-button"
                disabled={busy || !title.trim()}
                onClick={act}
              >
                {action === "edit" ? "Confirm edit" : "Confirm create"}
              </button>
            </>
          ) : action === "disconnect" ? (
            <button
              onClick={async () => {
                try {
                  await window.hrig.integrate({
                    op: "disconnectLinear",
                    confirmed: true,
                  });
                  setCredential(false);
                  setCatalog(null);
                  setItems([]);
                  setAction("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Confirm disconnect
            </button>
          ) : (
            <>
              {provider === "local" && (
                <div className="arrange-controls">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setTitle(selected!.title);
                      setBody(selected!.body);
                      setAction("edit");
                    }}
                  >
                    Edit local task
                  </button>
                  <button disabled={busy} onClick={() => setAction("delete")}>
                    Delete local task
                  </button>
                  {action === "delete" && (
                    <>
                      <span>Delete this local task permanently?</span>
                      <button disabled={busy} onClick={act}>
                        Confirm delete task
                      </button>
                    </>
                  )}
                </div>
              )}
              <p className="work-description">{selected?.body}</p>
              {selected?.url && (
                <p className="field-note">
                  Source: {selected.url}{" "}
                  <button
                    className="small-button"
                    onClick={() =>
                      window.hrig
                        .openWorkLink(selected.url)
                        .catch((e) => setError(e.message))
                    }
                  >
                    Open source in browser
                  </button>
                </p>
              )}
              {provider !== "projects" && (
                <>
                  <label className="field-label">
                    NEW STATUS
                    <select
                      aria-label="Work item status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">Choose status</option>
                      {(provider === "local"
                        ? ["Todo", "Doing", "Done"].map((s) => ({
                            id: s,
                            name: s,
                          }))
                        : provider === "linear"
                          ? catalog?.teams.nodes.find(
                              (t: any) => t.id === selected?.team,
                            )?.states.nodes || []
                          : statuses
                      ).map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    disabled={busy || !status}
                    onClick={() => setAction("update")}
                  >
                    Review status change
                  </button>
                  {action === "update" && (
                    <div className="external-change">
                      <span>Update this exact item in {provider}?</span>
                      <button disabled={busy} onClick={act}>
                        Confirm status update
                      </button>
                    </div>
                  )}
                </>
              )}
              <label className="field-label">
                ASSIGN TO OPENRIG SEAT
                <select
                  aria-label="Board task recipient"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose seat</option>
                  {seats.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}@{s.rigName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={
                  busy ||
                  !target ||
                  !!config.links[selected ? itemKey(selected) : ""]
                }
                onClick={() => setAction("assign")}
              >
                Review OpenRig assignment
              </button>
              {action === "assign" && (
                <div className="external-change">
                  <span>
                    Create an assigned OpenRig task containing the source link
                    and description? The source issue will not change.
                  </span>
                  <button disabled={busy} onClick={act}>
                    Confirm OpenRig assignment
                  </button>
                </div>
              )}
            </>
          )}
          {error && <ErrorBox error={error} />}
        </Modal>
      )}
    </div>
  );
}
