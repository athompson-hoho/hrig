import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { Inventory, Seat } from "../src/types";
import "./style.css";
import PairComputer from "./PairComputer";
import {
  hostRequest,
  reconnectProfile,
  LinkError,
  type HostProfile,
} from "./link";

type Host = { id: string; name: string };
type Task = { id: string; title: string; status: string; destination: string };
function App() {
  const [endpoint, setEndpoint] = useState(
    () =>
      localStorage.getItem("hrig-host") ||
      (Capacitor.isNativePlatform() ? "" : location.origin),
  );
  const [key, setKey] = useState("");
  const [hosts, setHosts] = useState<Host[]>([]);
  const [connection, setConnection] = useState("");
  const [paired, setPaired] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [autoConnect, setAutoConnect] = useState(true);
  const profile = useRef<HostProfile | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState("Sessions");
  const [seat, setSeat] = useState<Seat | null>(null);
  const [screen, setScreen] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
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
    const target = url.origin + "/api";
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const data = { op, connectionId: connection, ...extra };
    let status: number, payload: { result: T; error?: string };
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.post({
        url: target,
        headers,
        data,
        connectTimeout: 15000,
        readTimeout: 60000,
      });
      status = response.status;
      payload = response.data;
    } else {
      const response = await fetch(target, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(60000),
      });
      status = response.status;
      payload = await response.json();
    }
    if (status !== 200)
      throw new Error(payload.error || `Host returned ${status}`);
    return payload.result;
  }
  async function pair(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const found = await call<Host[]>("connections");
      setHosts(found);
      setConnection(found[0]?.id || "");
      setPaired(true);
      localStorage.setItem("hrig-host", new URL(endpoint).origin);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!paired || !connection) return;
    const id = ++generation.current;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    setInventory(null);
    setTasks([]);
    setSeat(null);
    setError("");
    const refresh = async () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(refresh, 5000);
        return;
      }
      try {
        if (failures && profile.current) {
          const resumed = await reconnectProfile(profile.current);
          if (stopped) return;
          profile.current = resumed.profile;
          setHosts(resumed.hosts);
        }
        const [latest, queue] = await Promise.all([
          call<Inventory>("inventory"),
          call<Task[]>("queue"),
        ]);
        if (!stopped && generation.current === id) {
          setInventory(latest);
          setTasks(queue);
          setError("");
          setLastUpdate(Date.now());
          failures = 0;
        }
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          failures++;
        }
        if (e instanceof LinkError && e.status === 401) return;
      }
      if (!stopped)
        timer = setTimeout(
          refresh,
          Math.min(30000, 4000 * 2 ** Math.min(failures, 3)),
        );
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [paired, connection]);
  useEffect(() => {
    if (!seat) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setScreen("");
    const refresh = async () => {
      try {
        if (document.visibilityState !== "hidden") {
          const text = await call<string>("screen", { seatId: seat.id });
          if (!stopped) setScreen(text);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(refresh, 4000);
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [seat?.id, connection]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!seat) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await call("message", { seatId: seat.id, message });
      setMessage("");
      setNotice("Message sent to " + seat.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
              setLastUpdate(null);
              setKey("");
              setSeat(null);
              setInventory(null);
              setTasks([]);
              setError("");
              setNotice("");
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
            setHosts(found);
            setConnection(found[0]?.id || "");
            setPaired(true);
            setError("");
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
                placeholder="http://100.x.y.z:5180"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
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
            Start the companion gateway on your computer. Your pairing key stays
            in memory until you disconnect.
          </p>
        </section>
      ) : (
        <>
          <section className="host">
            <label>
              CONNECTED MACHINE
              <select
                aria-label="Machine"
                value={connection}
                onChange={(e) => {
                  setConnection(e.target.value);
                  setNotice("");
                }}
              >
                <option value="" disabled>
                  Choose a connection
                </option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="badge">
              {error
                ? "Offline / needs attention"
                : inventory
                  ? "Connected"
                  : "Connecting"}
            </span>
          </section>
          {error && lastUpdate && (
            <p role="status">
              Showing saved session data. Last updated{" "}
              {new Date(lastUpdate).toLocaleTimeString()}. Messages are never
              replayed automatically.
            </p>
          )}
          {hosts.length === 0 && (
            <p>
              Save a WSL or SSH connection in the hRig desktop app, then
              reconnect here.
            </p>
          )}
          {seat ? (
            <section>
              <button
                onClick={() => {
                  setSeat(null);
                  setNotice("");
                }}
              >
                ← All sessions
              </button>
              <h1>{seat.name}</h1>
              <p>
                {seat.rigName} · {seat.runtime} · {seat.status}
              </p>
              <div className="eyebrow">LIVE SCREEN · READ ONLY</div>
              <pre aria-label="Session screen">
                {screen || "Waiting for terminal output…"}
              </pre>
              <form onSubmit={send}>
                <label>
                  Message {seat.name}
                  <textarea
                    required
                    maxLength={50000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Ask for an update or send instructions…"
                  />
                </label>
                <button className="primary" disabled={busy || !message.trim()}>
                  {busy ? "Sending…" : "Send message ↑"}
                </button>
              </form>
            </section>
          ) : (
            <section>
              <div className="section-title">
                <h1>{tab}</h1>
                <span>
                  {tab === "Sessions"
                    ? (inventory?.seats.length ?? "…")
                    : tasks.length}
                </span>
              </div>
              {tab === "Sessions" ? (
                <>
                  {inventory?.rigs.map((rig) => (
                    <div key={rig.id} className="rig">
                      <h2>
                        {rig.name}
                        <small>{rig.status}</small>
                      </h2>
                      {inventory.seats
                        .filter((s) => s.rigId === rig.id)
                        .map((s) => (
                          <button
                            className="seat"
                            key={s.id}
                            onClick={() => {
                              setSeat(s);
                              setNotice("");
                              setMessage("");
                            }}
                          >
                            <div>
                              <strong>{s.name}</strong>
                              <span>
                                {s.activity || s.runtime || "Agent session"}
                              </span>
                            </div>
                            <span className="status">{s.status} ›</span>
                          </button>
                        ))}
                    </div>
                  ))}
                  {inventory && !inventory.rigs.length && (
                    <p>No rigs found on this connection.</p>
                  )}
                </>
              ) : (
                <>
                  {tasks.map((task) => (
                    <article key={task.id}>
                      <span className="eyebrow">{task.status}</span>
                      <h2>{task.title}</h2>
                      <p>{task.destination}</p>
                    </article>
                  ))}
                  {!tasks.length && <p>No active tasks.</p>}
                </>
              )}
            </section>
          )}
          <nav>
            {["Sessions", "Tasks"].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => {
                  setTab(t);
                  setSeat(null);
                  setNotice("");
                }}
              >
                {t === "Sessions" ? "◈ " : "☷ "}
                {t}
              </button>
            ))}
          </nav>
        </>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
