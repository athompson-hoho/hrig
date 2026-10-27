import { useEffect, useState } from "react";
import { Send, ListTodo, Activity, RefreshCw, Bot } from "lucide-react";
import { Empty, ErrorBox, IconButton, Loading, StatusDot } from "./components";
import type { Connection, Seat } from "./types";
import { draftKey, draftOperation, useDraft } from "./drafts";
function RecipientMessage({
  connection,
  root,
  seat,
  onSent,
}: {
  connection: Connection;
  root: string;
  seat: Seat;
  onSent: (text: string) => void;
}) {
  const key = draftKey(
    "message",
    connection,
    root,
    JSON.stringify([seat.rigId, seat.rigName, seat.id, seat.name]),
  );
  const [draft, setDraft, storageError] = useDraft(
    key,
    "message",
    {
      message: "",
      status: "draft",
      history: [] as { text: string; time: string }[],
    },
    { connection, root, seatId: seat.id, rigId: seat.rigId },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const address = seat.name + "@" + seat.rigName;
  const send = async () => {
    const snapshot = draft.message;
    setBusy(true);
    setError("");
    const pending = { ...draft, status: "sending" };
    try {
      draftOperation("put", key, {
        kind: "message",
        connection,
        root,
        data: pending,
      });
      setDraft(pending);
      await window.hrig.sendMessage(connection, address, snapshot);
      setDraft({
        ...draft,
        message: "",
        status: "accepted",
        history: [
          { text: snapshot, time: new Date().toISOString() },
          ...draft.history,
        ].slice(0, 20),
      });
      onSent("Message accepted by OpenRig for " + address);
    } catch (e) {
      setError((e as Error).message);
      setDraft({ ...draft, status: "unknown" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <label className="field-label">
        MESSAGE
        <textarea
          aria-label="Message draft"
          value={draft.message}
          disabled={busy}
          onChange={(e) =>
            setDraft({ ...draft, message: e.target.value, status: "draft" })
          }
          placeholder="What would you like this seat to work on?"
          rows={7}
        />
      </label>
      {(error || storageError) && <ErrorBox error={error || storageError} />}
      {["unknown", "sending"].includes(draft.status) && !busy && (
        <p role="status" className="editor-notice">
          Delivery is uncertain. Your draft is preserved. Check with the
          recipient before deliberately sending again; HRig never retries
          automatically.
        </p>
      )}
      {draft.status === "accepted" && (
        <p role="status" className="success-note">
          Accepted by OpenRig. This does not confirm the agent read it.
        </p>
      )}
      <button
        className="primary-button"
        disabled={busy || !draft.message.trim() || !!storageError}
        onClick={send}
      >
        <Send size={14} />
        {busy
          ? "Sending…"
          : ["unknown", "sending"].includes(draft.status)
            ? "Send again deliberately"
            : "Send message"}
      </button>
      <p className="field-note">
        Draft saved locally for {address} in this project. Sending a message
        does not create a task.
      </p>
      <div className="sent-messages">
        {draft.history.map((h, i) => (
          <div key={i}>
            <span>
              {address}
              <small>{h.time}</small>
            </span>
            <p>{h.text}</p>
          </div>
        ))}
      </div>
    </>
  );
}
export function MessagePanel({
  connection,
  root,
  seats,
  onSent,
}: {
  connection: Connection;
  root: string;
  seats: Seat[];
  onSent: (text: string) => void;
}) {
  const [target, setTarget] = useState("");
  const seat = seats.find((s) => s.id === (target || seats[0]?.id));
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
          description="Connect and refresh a machine with a running rig to send messages. Saved drafts remain on this computer."
        />
      ) : (
        <>
          <label className="field-label">
            TO
            <select
              aria-label="Message recipient"
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
          {seat && (
            <RecipientMessage
              key={JSON.stringify([connection, root, seat.rigId, seat.id])}
              connection={connection}
              root={root}
              seat={seat}
              onSent={onSent}
            />
          )}
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
