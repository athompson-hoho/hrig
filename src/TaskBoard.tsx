import { useEffect, useState } from "react";
import { ListTodo, Plus, RefreshCw, ArrowUpRight } from "lucide-react";
import type { Connection, Seat } from "./types";
import { ErrorBox, Loading, Modal } from "./components";
export default function TaskBoard({
  connection,
  rigName,
  seats,
  onSeat,
}: {
  connection: Connection;
  rigName?: string;
  seats: Seat[];
  onSeat: (seat: Seat) => void;
}) {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [owner, setOwner] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      window.hrig
        .queue(connection, rigName)
        .then((r) => {
          if (active) {
            setItems(r);
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
  const addresses = seats.map((s) => ({
    seat: s,
    address: s.name + "@" + s.rigName,
  }));
  const inspect = (item: any) => {
    setSelected(item);
    setDetail(null);
    setDestination(item.destination || "");
    window.hrig
      .rigAction(connection, { op: "taskShow", id: item.id })
      .then(setDetail)
      .catch((e) => setDetail({ error: e.message }));
  };
  const mutate = async (op: string) => {
    setBusy(true);
    setError("");
    try {
      if (op === "taskHandoff") {
        await window.hrig.sendMessage(
          connection,
          selected.destination,
          `Please hand off OpenRig task ${selected.id} to ${destination}, following the rig's ownership and review policy. Report whether the handoff was completed or refused.`,
        );
        setNotice(
          "Handoff requested from the owning seat. OpenRig will report the resulting task state.",
        );
      } else
        await window.hrig.rigAction(connection, {
          op,
          id: selected?.id,
          title: title || selected?.title,
          destination,
          body,
        });
      setCreate(false);
      setSelected(null);
      setRefresh((n) => n + 1);
      setTitle("");
      setBody("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const visible = (items || []).filter(
    (i) =>
      (!stateFilter || i.status === stateFilter) &&
      (!owner || i.destination === owner) &&
      (!filter || String(i.title).toLowerCase().includes(filter.toLowerCase())),
  );
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <ListTodo />
        <div>
          <h3>Task queue</h3>
          <p>
            {rigName || "All rigs"} · Latest 1,000 active items from OpenRig
          </p>
        </div>
        <button
          className="small-button"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={13} />
          Refresh
        </button>
        <button
          className="primary-button"
          onClick={() => {
            setError("");
            setDestination(addresses[0]?.address || "");
            setCreate(true);
          }}
          disabled={!addresses.length}
        >
          <Plus size={13} />
          Assign work
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      {notice && <p className="success-note">{notice}</p>}
      <div className="form-grid">
        <input
          aria-label="Filter tasks"
          placeholder="Filter tasks…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          aria-label="Filter task owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">All owners</option>
          {addresses.map((a) => (
            <option key={a.address}>{a.address}</option>
          ))}
        </select>
        <select
          aria-label="Filter task state"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="">All states</option>
          {["pending", "in-progress", "blocked", "failed"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {items === null && !error ? (
        <Loading />
      ) : items === null && error ? null : !items?.length ? (
        <div className="panel-empty">
          <ListTodo size={28} />
          <h3>Room for your next idea</h3>
          <p>Assign work to a seat or wait for your team’s tasks.</p>
        </div>
      ) : (
        <div className="task-board">
          {["pending", "in-progress", "blocked", "other"].map((state) => (
            <section className="task-column" key={state}>
              <h4>
                {state === "other" ? "Other states" : state}
                <span>
                  {
                    visible.filter((i) =>
                      state === "other"
                        ? !["pending", "in-progress", "blocked"].includes(
                            i.status,
                          )
                        : i.status === state,
                    ).length
                  }
                </span>
              </h4>
              {visible
                .filter((i) =>
                  state === "other"
                    ? !["pending", "in-progress", "blocked"].includes(i.status)
                    : i.status === state,
                )
                .map((item) => (
                  <button
                    className="task-card"
                    key={item.id}
                    onClick={() => inspect(item)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.destination}</span>
                    <small className="badge">{item.status}</small>
                  </button>
                ))}
            </section>
          ))}
        </div>
      )}
      {(create || selected) && (
        <Modal
          title={create ? "Assign work to a seat" : "Task details"}
          subtitle={
            create
              ? "Creates an OpenRig queue item and uses its normal delivery behavior."
              : String(selected.id)
          }
          onClose={() => {
            setCreate(false);
            setSelected(null);
          }}
          wide
        >
          {error && <ErrorBox error={error} />}{" "}
          {create ? (
            <>
              <label className="field-label">
                SUBJECT
                <input
                  aria-label="Task subject"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="field-label">
                TASK BRIEF
                <textarea
                  aria-label="Task brief"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                />
              </label>
            </>
          ) : detail ? (
            <pre className="json-result">{JSON.stringify(detail, null, 2)}</pre>
          ) : (
            <Loading />
          )}
          <label className="field-label">
            OWNER
            <select
              aria-label="Task destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">Choose a seat…</option>
              {addresses.map((a) => (
                <option key={a.address}>{a.address}</option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            {!create && (
              <button
                className="secondary-button"
                onClick={() => {
                  const seat = addresses.find(
                    (a) => a.address === selected.destination,
                  )?.seat;
                  if (seat) {
                    onSeat(seat);
                    setSelected(null);
                  }
                }}
              >
                Open owning seat <ArrowUpRight size={13} />
              </button>
            )}
            <button
              className="primary-button"
              disabled={
                busy ||
                !destination ||
                (create && (!title.trim() || !body.trim())) ||
                (!create && destination === selected?.destination)
              }
              onClick={() => mutate(create ? "taskCreate" : "taskHandoff")}
            >
              {busy
                ? "Sending…"
                : create
                  ? "Create assigned task"
                  : "Request handoff from owner"}
            </button>
          </div>
          <p className="field-note">
            OpenRig enforces ownership and policy. HRig does not impersonate a
            managed seat; an unsupported or refused action is shown as an error.
          </p>
        </Modal>
      )}
    </div>
  );
}
