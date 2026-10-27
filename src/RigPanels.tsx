import { useEffect, useState } from "react";
import { Send, ListTodo, Activity, RefreshCw, Bot } from "lucide-react";
import { Empty, ErrorBox, IconButton, Loading, StatusDot } from "./components";
import type { Connection, Seat } from "./types";
export function MessagePanel({
  connection,
  seats,
  onSent,
}: {
  connection: Connection;
  seats: Seat[];
  onSent: (text: string) => void;
}) {
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<
    { target: string; text: string; time: string }[]
  >([]);
  const send = async () => {
    setBusy(true);
    setError("");
    const seat = target || seats[0]?.id;
    const selected = seats.find((s) => s.id === seat);
    if (!selected) {
      setBusy(false);
      return;
    }
    const address = `${selected.name}@${selected.rigName}`;
    try {
      await window.hrig.sendMessage(connection, address, message);
      setHistory((h) => [
        {
          target: address,
          text: message,
          time: new Date().toLocaleTimeString(),
        },
        ...h,
      ]);
      setMessage("");
      onSent(`Message delivered to ${address}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <Send size={18} />
        <div>
          <h3>Talk to your team</h3>
          <p>Send a message through OpenRig.</p>
        </div>
      </div>
      {!seats.length ? (
        <Empty
          icon={<Bot size={28} />}
          title="No seats available"
          description="Connect a machine with a running rig to send messages."
        />
      ) : (
        <>
          <label className="field-label">
            TO
            <select
              value={target || seats[0]?.id}
              onChange={(e) => setTarget(e.target.value)}
            >
              {seats.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}@{s.rigName}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            MESSAGE
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What would you like this seat to work on?"
              rows={7}
            />
          </label>
          {error && <ErrorBox error={error} />}
          <button
            className="primary-button"
            disabled={busy || !message.trim()}
            onClick={send}
          >
            <Send size={14} />
            {busy ? "Sending…" : "Send message"}
          </button>
          <p className="field-note">
            Sending a message does not create a task automatically. The agent
            manages its work through OpenRig.
          </p>
          <div className="sent-messages">
            {history.map((h, i) => (
              <div key={i}>
                <span>
                  {h.target}
                  <small>{h.time}</small>
                </span>
                <p>{h.text}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
export function QueuePanel({
  connection,
  rigName,
}: {
  connection: Connection;
  rigName?: string;
}) {
  const [items, setItems] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () =>
      window.hrig
        .queue(connection, rigName)
        .then((data) => {
          if (active) {
            setItems(data);
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
  }, [connection.id, rigName, refresh]);
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <ListTodo size={19} />
        <div>
          <h3>Task queue</h3>
          <p>
            {rigName || "All rigs"} · Latest 1,000 active tasks · refreshes
            every 15 seconds
          </p>
        </div>
        <IconButton
          title="Refresh task queue"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={14} />
        </IconButton>
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : items === null ? (
        <Loading />
      ) : items.length ? (
        <div className="queue-list">
          {items.map((item, i) => (
            <div key={String(item.id || i)}>
              <StatusDot status={String(item.status || "unknown")} />
              <section>
                <strong>
                  {String(
                    item.title ||
                      item.subject ||
                      item.summary ||
                      item.id ||
                      "Task",
                  )}
                </strong>
                <p>
                  {String(
                    item.destination ||
                      item.owner ||
                      item.assignedTo ||
                      "Unassigned",
                  )}
                </p>
              </section>
              <span className="badge">{String(item.status || "unknown")}</span>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<ListTodo size={28} />}
          title="Room for your next idea"
          description="Tasks owned by your OpenRig team will appear here."
        />
      )}
    </div>
  );
}
export interface ActivityEntry {
  id: string;
  time: string;
  text: string;
  kind: "info" | "error" | "success";
}
export function ActivityPanel({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <Activity size={18} />
        <div>
          <h3>Workspace activity</h3>
          <p>Connections, sessions, and workspace events</p>
        </div>
      </div>
      {entries.map((e) => (
        <div className={`activity-entry ${e.kind}`} key={e.id}>
          <span className="activity-marker" />
          <div>
            <p>{e.text}</p>
            <small>{e.time}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
