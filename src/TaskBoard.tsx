import {
  useEffect,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import {
  ListTodo,
  Plus,
  RefreshCw,
  ArrowUpRight,
  Download,
} from "lucide-react";
import type { Connection, Seat } from "./types";
import { ErrorBox, Loading, Modal } from "./components";
import TaskDetailBody from "./TaskDetailBody";
import {
  MAX_FILTER_TEXT,
  TASK_STATES,
  applyFilters,
  emptyFilters,
  hasFilters,
  itemTags,
  normalizeFilters,
  staleFilters,
  staleNote,
  tagOptions,
  type TaskFilters,
} from "./task-filters";
import { reasonOf } from "./task-reason";
import { ageBadge, isStuck } from "./task-age";
import { ageOf } from "./task-age";
import {
  boardColumns,
  cellAtIndex,
  cellIndex,
  moveFocus,
  stopAt,
  tabCell,
  type Stop,
} from "./task-board-nav";
import {
  exportButton,
  exportFile,
  exportNotice,
  exportRows,
  type ExportFormat,
} from "./task-export";
import { downloadText } from "./download-text";
export default function TaskBoard({
  connection,
  rigName,
  seats,
  onSeat,
  savedFilters,
  onFilters,
}: {
  connection: Connection;
  rigName?: string;
  seats: Seat[];
  onSeat: (seat: Seat) => void;
  savedFilters?: TaskFilters;
  onFilters?: (filters: TaskFilters) => void;
}) {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(() => normalizeFilters(savedFilters));
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  // The card that last had focus (the board's one tab stop) and, while a refresh lands, the board that had focus.
  const [stop, setStop] = useState<Stop | null>(null);
  const [held, setHeld] = useState<Element | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      window.hrig
        .queue(connection, rigName)
        .then((r) => {
          if (active) {
            setHeld(
              typeof document === "undefined"
                ? null
                : document.activeElement?.closest(".task-board") || null,
            );
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
  // A refresh that moves the focused card to another column replaces its element. Put focus back on the board's tab stop
  // only when the board had focus and lost it; focus that is anywhere else is never moved.
  useEffect(() => {
    if (!held || typeof document === "undefined") return;
    if (held.contains(document.activeElement)) return;
    held.querySelector<HTMLElement>('.task-card[tabindex="0"]')?.focus();
  }, [items]);
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
  // Saves the tasks the board shows and nothing else: one row per shown task in the fixed export columns, never a whole task or its body (see task-export.ts). It only reads the list; nothing is sent and no task changes.
  const exportShown = (format: ExportFormat, list: any[], at: number) => {
    try {
      const set = exportRows(list, at, {
        tags: itemTags,
        age: ageOf,
        reason: reasonOf,
      });
      const file = exportFile(format, set.rows, at);
      downloadText(file.name, file.text, file.type);
      setNotice(exportNotice(format, set.rows.length, set.total));
    } catch (e) {
      setError("Could not export: " + (e as Error).message);
    }
  };
  const visible = applyFilters(items || [], filters);
  const columns = boardColumns(visible);
  const shown = columns.reduce((n, c) => n + c.items.length, 0);
  const exportCsv = exportButton("csv", shown);
  const exportMarkdown = exportButton("md", shown);
  const tab = tabCell(columns, stop);
  const tags = tagOptions(items || []);
  const stale = staleFilters(
    filters,
    addresses.map((a) => a.address),
    items,
  );
  const update = (patch: Partial<TaskFilters>) => {
    const next = normalizeFilters({ ...filters, ...patch });
    setFilters(next);
    // The text box is a quick search typed key by key: only seat, state and tag are remembered.
    if (patch.text === undefined) onFilters?.(next);
  };
  const clearFilters = () => {
    setFilters(emptyFilters());
    onFilters?.(emptyFilters());
  };
  // Only the card that last had focus is a tab stop, so Tab crosses the board in one step.
  const tabFor = (col: number, row: number) =>
    tab && tab.col === col && tab.row === row ? 0 : -1;
  const cardsOf = (board: HTMLElement) =>
    Array.from(board.querySelectorAll<HTMLElement>(".task-card"));
  // Arrows, Home and End move focus between cards. Only a key typed on a card is looked at, and only a handled key is consumed.
  const onBoardKey = (event: KeyboardEvent<HTMLElement>) => {
    const cards = cardsOf(event.currentTarget);
    const here = cards.indexOf(event.target as HTMLElement);
    if (here < 0) return;
    const to = moveFocus(columns, cellAtIndex(columns, here), event);
    if (!to) return;
    event.preventDefault();
    const next = cards[cellIndex(columns, to)];
    if (next && next !== event.target) next.focus();
  };
  const onBoardFocus = (event: FocusEvent<HTMLElement>) => {
    const at = cardsOf(event.currentTarget).indexOf(
      event.target as HTMLElement,
    );
    const next = stopAt(columns, cellAtIndex(columns, at));
    if (next) setStop(next);
  };
  const reasonNote = (item: any) => {
    const reason = reasonOf(item);
    return reason ? (
      <span data-reason={reason.kind} title={reason.title}>
        {reason.line}
      </span>
    ) : null;
  };
  // Ages are measured at render time; the board renders again on every refresh.
  const now = Date.now();
  const ageNote = (item: any) => {
    const badge = ageBadge(item, now);
    return badge ? (
      <small
        className="badge"
        data-stuck={badge.stuck ? "true" : undefined}
        title={badge.title}
      >
        {badge.text}
      </small>
    ) : null;
  };
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
          className="small-button"
          onClick={() => exportShown("csv", visible, now)}
          disabled={!shown}
          title={exportCsv.title}
        >
          <Download size={13} />
          {exportCsv.text}
        </button>
        <button
          className="small-button"
          onClick={() => exportShown("md", visible, now)}
          disabled={!shown}
          title={exportMarkdown.title}
        >
          <Download size={13} />
          {exportMarkdown.text}
        </button>
        <button
          className="primary-button"
          onClick={() => {
            setError("");
            setDestination(addresses[0]?.address || "");
            setCreate(true);
          }}
          disabled={!addresses.length}
          title={
            addresses.length
              ? undefined
              : "No seats available to assign work to. Refresh rigs in the sidebar."
          }
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
          maxLength={MAX_FILTER_TEXT}
          value={filters.text}
          onChange={(e) => update({ text: e.target.value })}
        />
        <select
          aria-label="Filter task owner"
          value={filters.seat}
          onChange={(e) => update({ seat: e.target.value })}
        >
          <option value="">All owners</option>
          {filters.seat !== "" &&
            !addresses.some((a) => a.address === filters.seat) && (
              <option value={filters.seat}>{filters.seat}</option>
            )}
          {addresses.map((a) => (
            <option key={a.address}>{a.address}</option>
          ))}
        </select>
        <select
          aria-label="Filter task state"
          value={filters.state}
          onChange={(e) => update({ state: e.target.value })}
        >
          <option value="">All states</option>
          {TASK_STATES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Filter task tag"
          value={filters.tag}
          onChange={(e) => update({ tag: e.target.value })}
        >
          <option value="">All tags</option>
          {filters.tag !== "" && !tags.includes(filters.tag) && (
            <option value={filters.tag}>{filters.tag}</option>
          )}
          {tags.map((t) => (
            <option key={t}>{t}</option>
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
        <>
          {!visible.length && (
            <div className="panel-empty" role="status">
              <ListTodo size={28} />
              <h3>No tasks match these filters</h3>
              {staleNote(stale) && <p>{staleNote(stale)}</p>}
              <p>
                Clear the filter, owner, state or tag to see all {items.length}{" "}
                active items.
              </p>
              <button className="small-button" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
          {hasFilters(filters) && visible.length > 0 && (
            <p className="field-note" role="status">
              Showing {visible.length} of {items.length} tasks.{" "}
              <button className="small-button" onClick={clearFilters}>
                Clear filters
              </button>
            </p>
          )}
        <div
          className="task-board"
          role="group"
          aria-label="Tasks by state. Use the arrow keys, Home and End to move between tasks."
          onKeyDown={onBoardKey}
          onFocus={onBoardFocus}
        >
          {columns.map((column, col) => (
            <section
              className="task-column"
              key={column.state}
              aria-label={
                column.label +
                ", " +
                column.items.length +
                (column.items.length === 1 ? " task" : " tasks")
              }
            >
              <h4>
                {column.label}
                <span>{column.items.length}</span>
              </h4>
              {column.items.map((item, row) => (
                <button
                  className="task-card"
                  key={item.id}
                  onClick={() => inspect(item)}
                  tabIndex={tabFor(col, row)}
                  data-stuck={isStuck(item, now) ? "true" : undefined}
                >
                  <strong>{item.title}</strong>
                  <span>{item.destination}</span>
                  {reasonNote(item)}
                  <small className="badge">{item.status}</small>
                  {ageNote(item)}
                </button>
              ))}
            </section>
          ))}
        </div>
        </>
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
            <TaskDetailBody detail={detail}>
              <pre className="json-result">
                {JSON.stringify(detail, null, 2)}
              </pre>
            </TaskDetailBody>
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
