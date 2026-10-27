import { useEffect, useRef, useState } from "react";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { Inventory, Rig, Seat } from "../src/types";
import PairComputer from "./PairComputer";
import {
  hostRequest,
  reconnectProfile,
  LinkError,
  type HostProfile,
} from "./link";
import { useRemote } from "./useRemote";

type Host = { id: string; name: string; selected?: boolean; kind?: string };
type Task = Record<string, any> & {
  id: string;
  title: string;
  status: string;
  destination: string;
};
const chooseHost = (hosts: Host[]) =>
  hosts.find((host) => host.selected)?.id ||
  hosts.find((host) => host.kind === "wsl")?.id ||
  hosts[0]?.id ||
  "";
function date(value: unknown) {
  if (!value) return "Not reported";
  const d = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}
function Fields({ values }: { values: [string, unknown][] }) {
  return (
    <dl className="fields">
      {values
        .filter(
          ([, value]) => value !== undefined && value !== null && value !== "",
        )
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {typeof value === "object"
                ? JSON.stringify(value, null, 2)
                : String(value)}
            </dd>
          </div>
        ))}
    </dl>
  );
}
function LoadError({
  title,
  error,
  retry,
  updated,
}: {
  title: string;
  error: string;
  retry(): void;
  updated?: number | null;
}) {
  return (
    <div className="error" role="alert">
      <strong>{title}</strong>
      <p>{error}</p>
      {updated && (
        <p>Showing the last successful result from {date(updated)}.</p>
      )}
      <button onClick={retry}>Retry</button>
    </div>
  );
}
function groups(inventory: Inventory): (Rig & { seats: Seat[] })[] {
  const declared = inventory.rigs.map((rig) => ({
    ...rig,
    seats: inventory.seats.filter(
      (seat) =>
        seat.rigId === rig.id || (!seat.rigId && seat.rigName === rig.name),
    ),
  }));
  const included = new Set(
    declared.flatMap((group) => group.seats.map((seat) => seat.id)),
  );
  for (const seat of inventory.seats.filter((seat) => !included.has(seat.id))) {
    const id = "unlisted:" + (seat.rigId || seat.rigName || "unknown");
    let group = declared.find((item) => item.id === id);
    if (!group) {
      group = {
        id,
        name: seat.rigName || "Other sessions",
        status: "Not in rig list",
        nodeCount: 0,
        seats: [],
      };
      declared.push(group);
    }
    group.seats.push(seat);
  }
  return declared;
}
export default function App() {
  const [endpoint, setEndpoint] = useState(
    () =>
      localStorage.getItem("hrig-host") ||
      (Capacitor.isNativePlatform() ? "" : location.origin),
  );
  const [key, setKey] = useState(""),
    [hosts, setHosts] = useState<Host[]>([]),
    [connection, setConnection] = useState("");
  const [paired, setPaired] = useState(false),
    [legacy, setLegacy] = useState(false),
    [autoConnect, setAutoConnect] = useState(true);
  const profile = useRef<HostProfile | null>(null),
    generation = useRef(0);
  const drafts = useRef(new Map<string, string>());
  const [tab, setTab] = useState("Sessions"),
    [seatId, setSeatId] = useState(""),
    [taskId, setTaskId] = useState("");
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [sendError, setSendError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [sending, setSending] = useState(false),
    [search, setSearch] = useState("");
  const draftKey = (id: string) =>
    `${profile.current?.hostId || endpoint}|${connection}|${id}`;
  useEffect(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
  }, [tab, seatId, taskId, connection]);
  async function call<T>(
    op: string,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    if (profile.current)
      return hostRequest(profile.current, {
        op,
        connectionId: connection,
        ...extra,
      }) as Promise<T>;
    const url = new URL(endpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Enter an HTTP or HTTPS host address.");
    const headers = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      data = { op, connectionId: connection, ...extra };
    let response: { status: number; data: any };
    if (Capacitor.isNativePlatform())
      response = await CapacitorHttp.post({
        url: url.origin + "/api",
        headers,
        data,
        connectTimeout: 10000,
        readTimeout: 60000,
      });
    else {
      const result = await fetch(url.origin + "/api", {
        method: "POST",
        headers,
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(60000),
      });
      response = { status: result.status, data: await result.json() };
    }
    if (response.status !== 200)
      throw new LinkError(
        response.data.error || `Host returned ${response.status}`,
        response.status,
      );
    return response.data.result;
  }
  async function read<T>(
    op: string,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    // Only reads may reconnect/try another saved address. Never replay a send.
    try {
      return await call<T>(op, extra);
    } catch (failure) {
      if (!profile.current || (failure instanceof LinkError && failure.status))
        throw failure;
      const previous = profile.current;
      const resumed = await reconnectProfile(previous);
      if (profile.current !== previous) throw failure;
      profile.current = resumed.profile;
      return call<T>(op, extra);
    }
  }
  const inventory = useRemote<Inventory>(
    paired && !!connection,
    connection,
    () => read("inventory"),
    10000,
  );
  const queue = useRemote<Task[]>(
    paired && !!connection,
    connection,
    () => read("queue"),
    15000,
  );
  const selectedSeat = inventory.value?.seats.find(
    (seat) => seat.id === seatId,
  );
  const screen = useRemote<string>(
    paired && !!selectedSeat?.session,
    `${connection}:${seatId}:${selectedSeat?.session}`,
    () => read("screen", { seatId }),
    4000,
  );
  const detail = useRemote<Task>(
    paired && !!taskId,
    `${connection}:${taskId}`,
    () => read("task", { id: taskId }),
    0,
  );
  function clearSelection() {
    setSeatId("");
    setTaskId("");
    setNotice("");
    setSendError("");
    setSearch("");
    setMessage("");
  }
  function connected(found: Host[]) {
    generation.current++;
    setHosts(found);
    setConnection(chooseHost(found));
    setPaired(true);
    setTab("Sessions");
    clearSelection();
    setError("");
  }
  async function pair(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      connected(await call<Host[]>("connections"));
      localStorage.setItem("hrig-host", new URL(endpoint).origin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSeat || sending) return;
    const epoch = generation.current,
      name = selectedSeat.name,
      savedDraftKey = draftKey(selectedSeat.id);
    setSending(true);
    setSendError("");
    setNotice("");
    try {
      await call("message", { seatId: selectedSeat.id, message });
      drafts.current.delete(savedDraftKey);
      if (epoch === generation.current) {
        setMessage("");
        setNotice("Message sent to " + name);
      }
    } catch (e) {
      if (epoch === generation.current)
        setSendError(
          (e as Error).message +
            " Your draft is preserved. Check delivery before retrying; messages are never replayed automatically.",
        );
    } finally {
      if (epoch === generation.current) setSending(false);
    }
  }
  const query = search.trim().toLowerCase();
  const listed = inventory.value ? groups(inventory.value) : [];
  const tasks = (queue.value || []).filter(
    (task) =>
      !query ||
      `${task.title} ${task.destination} ${task.status}`
        .toLowerCase()
        .includes(query),
  );
  const summary = queue.value?.find((task) => task.id === taskId);
  const fullTask =
    detail.value &&
    ((detail.value as any).item ||
      (detail.value as any).task ||
      (detail.value as any).qitem ||
      detail.value);
  return (
    <main>
      <header>
        <div className="brand">
          h<span>Rig</span>
        </div>
        {paired && (
          <button
            onClick={() => {
              generation.current++;
              setPaired(false);
              profile.current = null;
              setLegacy(false);
              setAutoConnect(false);
              setKey("");
              setSending(false);
              clearSelection();
              setError("");
            }}
          >
            Disconnect
          </button>
        )}
      </header>
      {!paired && !legacy ? (
        <PairComputer
          autoConnect={autoConnect}
          onLegacy={() => setLegacy(true)}
          onConnect={(saved, found) => {
            profile.current = saved;
            setEndpoint(saved.activeURL);
            connected(found);
          }}
        />
      ) : !paired ? (
        <section className="pair">
          <button
            onClick={() => {
              setLegacy(false);
              setKey("");
              setError("");
            }}
          >
            ← Pair a computer
          </button>
          <div className="eyebrow">YOUR WORKSPACE, WITH YOU</div>
          <h1>
            Stay close to
            <br />
            your agents.
          </h1>
          <p>
            Connect to your hRig computer over your local network or Tailscale.
          </p>
          <form onSubmit={pair}>
            <label>
              Host address
              <input
                required
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="http://100.x.y.z:5180"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>
            <label>
              Pairing key
              <input
                required
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Connecting…" : "Connect to hRig →"}
            </button>
          </form>
          <p className="hint">
            Start the legacy gateway on the desktop. The shared key stays in
            memory until you disconnect.
          </p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="host">
            <label>
              CONNECTION
              <select
                aria-label="Machine"
                disabled={sending}
                value={connection}
                onChange={(e) => {
                  generation.current++;
                  setConnection(e.target.value);
                  clearSelection();
                }}
              >
                <option value="" disabled>
                  Choose a connection
                </option>
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                    {host.selected ? " · desktop selection" : ""}
                  </option>
                ))}
              </select>
            </label>
            <span className="badge">
              {inventory.error
                ? "Inventory unavailable"
                : inventory.value
                  ? "Connected"
                  : "Loading"}
            </span>
          </section>
          <p className="connection-caption">
            {profile.current?.name || new URL(endpoint).host} ·{" "}
            {hosts.find((host) => host.id === connection)?.name}
            {hosts.find((host) => host.id === connection)?.selected
              ? " · desktop selection"
              : ""}
          </p>
          {!hosts.length && (
            <p>Save a WSL or SSH connection in desktop hRig, then reconnect.</p>
          )}
          {inventory.error && (
            <LoadError
              title="Sessions could not refresh"
              error={inventory.error}
              retry={inventory.retry}
              updated={inventory.updated}
            />
          )}
          {queue.error && tab === "Sessions" && (
            <p className="hint">
              Task list unavailable. Sessions and terminal viewing remain
              available; open Tasks for the error and retry.
            </p>
          )}
          {seatId ? (
            <section className="content-stack">
              <button
                className="back"
                onClick={() => {
                  setSeatId("");
                  setNotice("");
                  setSendError("");
                }}
              >
                ← All sessions
              </button>
              {!selectedSeat ? (
                <p role="alert">
                  This seat is no longer in the current inventory. Return to
                  sessions and refresh.
                </p>
              ) : (
                <>
                  <div>
                    <h1>{selectedSeat.name}</h1>
                    <p>
                      {selectedSeat.rigName} · {selectedSeat.status}
                    </p>
                  </div>
                  <Fields
                    values={[
                      ["Runtime", selectedSeat.runtime],
                      ["Model", selectedSeat.model],
                      ["Pod", selectedSeat.pod],
                      ["Assigned work", selectedSeat.workCount],
                      ["Session", selectedSeat.session || "No live session"],
                    ]}
                  />
                  {selectedSeat.activity && (
                    <p className="activity">{selectedSeat.activity}</p>
                  )}
                  {selectedSeat.error && (
                    <div role="alert" className="error">
                      <strong>Seat error</strong>
                      <p>{selectedSeat.error}</p>
                    </div>
                  )}
                  <div className="section-title">
                    <h2>Terminal screen</h2>
                    {selectedSeat.session && (
                      <button onClick={screen.retry} disabled={screen.loading}>
                        Refresh screen
                      </button>
                    )}
                  </div>
                  {!selectedSeat.session ? (
                    <p>
                      No live terminal is available for this seat. Opening it
                      does not launch or restart the agent.
                    </p>
                  ) : (
                    <>
                      {screen.error && (
                        <LoadError
                          title="Terminal screen unavailable"
                          error={screen.error}
                          retry={screen.retry}
                          updated={screen.updated}
                        />
                      )}
                      <p className="hint">
                        Read-only · latest 200 terminal lines
                        {screen.updated
                          ? " · updated " +
                            new Date(screen.updated).toLocaleTimeString()
                          : ""}
                      </p>
                      <pre aria-label="Session screen">
                        {screen.value !== null
                          ? screen.value || "Terminal is currently blank."
                          : screen.loading
                            ? "Loading terminal screen…"
                            : "No terminal output available."}
                      </pre>
                    </>
                  )}
                  <form onSubmit={send}>
                    <label>
                      Message {selectedSeat.name}
                      <textarea
                        required
                        maxLength={50000}
                        value={message}
                        onChange={(e) => {
                          setMessage(e.target.value);
                          drafts.current.set(
                            draftKey(selectedSeat.id),
                            e.target.value,
                          );
                        }}
                        placeholder="Ask for an update or send instructions…"
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={sending || !message.trim()}
                    >
                      {sending ? "Sending…" : "Send message ↑"}
                    </button>
                  </form>
                  {sendError && (
                    <div className="error" role="alert">
                      {sendError}
                    </div>
                  )}
                  {notice && (
                    <div className="notice" role="status">
                      {notice}
                    </div>
                  )}
                </>
              )}
            </section>
          ) : taskId ? (
            <section className="content-stack">
              <button className="back" onClick={() => setTaskId("")}>
                ← All tasks
              </button>
              <h1>{summary?.title || "Task details"}</h1>
              {detail.loading && (
                <p role="status">Loading full task details…</p>
              )}
              {detail.error && (
                <LoadError
                  title="Full task details unavailable"
                  error={detail.error}
                  retry={detail.retry}
                />
              )}
              {fullTask ? (
                <>
                  <Fields
                    values={[
                      ["ID", fullTask.qitemId || fullTask.id || taskId],
                      ["State", fullTask.state || fullTask.status],
                      [
                        "Owner",
                        fullTask.destinationSession ||
                          fullTask.destination ||
                          fullTask.owner,
                      ],
                      ["Source", fullTask.sourceSession || fullTask.source],
                      ["Priority", fullTask.priority],
                      ["Created", date(fullTask.tsCreated)],
                      ["Updated", date(fullTask.tsUpdated)],
                      ["Tags", fullTask.tags],
                      ["Blocked on", fullTask.blockedOn],
                    ]}
                  />
                  {(
                    [
                      "humanIntent",
                      "summary",
                      "body",
                      "description",
                      "resolution",
                      "closureReason",
                    ] as const
                  )
                    .filter((field) => fullTask[field])
                    .map((field) => (
                      <div key={field}>
                        <h2>
                          {
                            {
                              humanIntent: "Intent",
                              summary: "Summary",
                              body: "Description",
                              description: "Description",
                              resolution: "Resolution",
                              closureReason: "Closure reason",
                            }[field]
                          }
                        </h2>
                        <p className="task-body">
                          {typeof fullTask[field] === "string"
                            ? fullTask[field]
                            : JSON.stringify(fullTask[field], null, 2)}
                        </p>
                      </div>
                    ))}
                  <details>
                    <summary>All task fields</summary>
                    <pre aria-label="All task fields">
                      {JSON.stringify(fullTask, null, 2)}
                    </pre>
                  </details>
                </>
              ) : (
                summary && (
                  <>
                    <p>Task summary from the last task list:</p>
                    <Fields
                      values={[
                        ["State", summary.status],
                        ["Owner", summary.destination],
                        ["Summary", summary.summary || summary.bodyPreview],
                      ]}
                    />
                  </>
                )
              )}
            </section>
          ) : (
            <section className="content-stack">
              <div className="section-title">
                <div>
                  <h1>{tab}</h1>
                  <p className="hint">
                    {tab === "Sessions"
                      ? `${inventory.value?.rigs.length ?? "…"} rigs · ${inventory.value?.seats.length ?? "…"} seats`
                      : `${queue.value?.length ?? "…"} tasks in the latest host window (up to 1,000)`}
                  </p>
                </div>
                <button
                  onClick={tab === "Sessions" ? inventory.retry : queue.retry}
                  disabled={
                    tab === "Sessions" ? inventory.loading : queue.loading
                  }
                >
                  Refresh {tab.toLowerCase()}
                </button>
              </div>
              <label className="search">
                Search {tab.toLowerCase()}
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    tab === "Sessions"
                      ? "Rig, seat, activity or model"
                      : "Title, owner or state"
                  }
                />
              </label>
              {tab === "Sessions" ? (
                <>
                  {inventory.loading && !inventory.value && (
                    <p role="status">Loading rigs and seats…</p>
                  )}
                  {listed.map((rig) => {
                    const seats = rig.seats.filter(
                      (seat) =>
                        !query ||
                        `${rig.name} ${seat.name} ${seat.activity} ${seat.runtime} ${seat.model} ${seat.status}`
                          .toLowerCase()
                          .includes(query),
                    );
                    if (
                      query &&
                      !seats.length &&
                      !rig.name.toLowerCase().includes(query)
                    )
                      return null;
                    return (
                      <div className="rig" key={rig.id}>
                        <div className="rig-heading">
                          <h2>{rig.name}</h2>
                          <span>
                            {rig.status} · {rig.seats.length}
                            {rig.nodeCount > rig.seats.length
                              ? ` / ${rig.nodeCount}`
                              : ""}{" "}
                            seats
                          </span>
                        </div>
                        {seats.map((seat) => (
                          <button
                            className="seat"
                            key={seat.id}
                            onClick={() => {
                              setSeatId(seat.id);
                              setNotice("");
                              setSendError("");
                              setMessage(
                                drafts.current.get(draftKey(seat.id)) || "",
                              );
                            }}
                          >
                            <div>
                              <strong>{seat.name}</strong>
                              <span>
                                {[seat.runtime, seat.model]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              {seat.activity && (
                                <span className="seat-activity">
                                  {seat.activity}
                                </span>
                              )}
                            </div>
                            <span className="status">{seat.status} ›</span>
                          </button>
                        ))}
                        {!rig.seats.length && (
                          <p>No seats were reported for this rig.</p>
                        )}
                      </div>
                    );
                  })}
                  {inventory.value && !listed.length && (
                    <p>No rigs or seats were reported for this connection.</p>
                  )}
                  {query &&
                    inventory.value &&
                    !inventory.value.seats.some((seat) =>
                      `${seat.rigName} ${seat.name} ${seat.activity} ${seat.runtime} ${seat.model} ${seat.status}`
                        .toLowerCase()
                        .includes(query),
                    ) && <p>No matching seats.</p>}
                </>
              ) : (
                <>
                  {queue.error && (
                    <LoadError
                      title="Tasks could not refresh"
                      error={queue.error}
                      retry={queue.retry}
                      updated={queue.updated}
                    />
                  )}
                  {queue.loading && !queue.value && (
                    <p role="status">Loading tasks…</p>
                  )}
                  {tasks.map((task) => (
                    <button
                      className="task-card"
                      key={task.id}
                      onClick={() => setTaskId(task.id)}
                    >
                      <span className="eyebrow">{task.status}</span>
                      <strong>{task.title}</strong>
                      <span>{task.destination}</span>
                      {task.priority !== undefined && (
                        <span>Priority {task.priority}</span>
                      )}
                      <span className="task-open">View full details →</span>
                    </button>
                  ))}
                  {queue.value && !tasks.length && (
                    <p>
                      {query
                        ? "No matching tasks."
                        : "No tasks were reported in the latest host window."}
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          <nav aria-label="Mobile sections">
            {["Sessions", "Tasks"].map((name) => (
              <button
                key={name}
                className={tab === name ? "active" : ""}
                aria-current={tab === name ? "page" : undefined}
                onClick={() => {
                  setTab(name);
                  setSeatId("");
                  setTaskId("");
                  setNotice("");
                  setSearch("");
                }}
              >
                {name === "Sessions" ? "◈ " : "☷ "}
                {name}
              </button>
            ))}
          </nav>
        </>
      )}
    </main>
  );
}
