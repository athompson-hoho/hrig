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
import TaskFileReferences from "./TaskFileReferences";
import { ownerHint, reviewNote, type TaskDraft } from "./task-draft";
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
import { VirtualList } from "./VirtualList";
import { pinConnectionIdentity } from "./seat-pins";
import { groupTasks, searchTasks, type TaskGroupBy } from "./task-view";
import { visibleInterval } from "./visible-interval";
export default function TaskBoard({
  connection,
  rigName,
  seats,
  onSeat,
  savedFilters,
  onFilters,
  draft,
  onDraftTaken,
  root,
  onFile,
}: {
  connection: Connection;
  rigName?: string;
  seats: Seat[];
  onSeat: (seat: Seat) => void;
  savedFilters?: TaskFilters;
  onFilters?: (filters: TaskFilters) => void;
  draft?: TaskDraft | null;
  onDraftTaken?: () => void;
  root?: string;
  onFile?: (path: string, line?: number) => void;
}) {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(() => normalizeFilters(savedFilters));
  const [groupBy, setGroupBy] = useState<TaskGroupBy>("state");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  // The draft the open Assign work dialog was prepared from, while that dialog is open.
  const [prepared, setPrepared] = useState<TaskDraft | null>(null);
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
    const stopPolling = visibleInterval(load, 15000);
    return () => {
      active = false;
      stopPolling();
    };
  }, [connection.id, rigName, refresh]);
  // A refresh that moves the focused card to another column replaces its element. Put focus back on the board's tab stop
  // only when the board had focus and lost it; focus that is anywhere else is never moved.
  useEffect(() => {
    if (!held || typeof document === "undefined") return;
    if (held.contains(document.activeElement)) return;
    held.querySelector<HTMLElement>('.task-card[tabindex="0"]')?.focus();
  }, [items]);
  // A draft prepared from a terminal selection only fills the Assign work dialog: the owner stays empty, nothing is created until the person presses Create assigned task, and a task already being written is never overwritten.
  useEffect(() => {
    if (!draft) return;
    if (create && (title.trim() || body.trim())) {
      setError(
        "The selection was not used because a task is already being written. Finish or close it, then try again.",
      );
    } else {
      setError("");
      setNotice("");
      setSelected(null);
      setDetail(null);
      setTitle(draft.subject);
      setBody(draft.body);
      setDestination("");
      setCreate(true);
      setPrepared(draft);
    }
    onDraftTaken?.();
  }, [draft]);
  // Closing a prepared dialog throws its text away, so a selection never comes back in a later Assign work dialog.
  useEffect(() => {
    if (create || !prepared) return;
    setPrepared(null);
    setTitle("");
    setBody("");
  }, [create, prepared]);
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
  // The search box looks at title, owner, state and id (every term must match); owner, state and tag are the saved filters.
  const visible = applyFilters(searchTasks(items || [], filters.text), {
    ...filters,
    text: "",
  });
  const taskScope = JSON.stringify([pinConnectionIdentity(connection), rigName]);
  // Grouped by state the columns are the fixed board columns; grouped by seat there is one column per owner.
  const columns =
    groupBy === "seat"
      ? groupTasks(visible, "seat")
      : boardColumns(visible).map((c) => ({ key: c.state, label: c.label, items: c.items }));
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
  // Long columns are windowed, so only some cards are in the page: a card says where it sits in data-col and data-row,
  // and the position in the page is used only when a card carries neither.
  const cellOfCard = (card: HTMLElement, cards: HTMLElement[]) => {
    const col = Number(card.dataset?.col);
    const row = Number(card.dataset?.row);
    return card.dataset?.col !== undefined &&
      Number.isInteger(col) &&
      Number.isInteger(row)
      ? { col, row }
      : cellAtIndex(columns, cards.indexOf(card));
  };
  const cardAtCell = (
    board: HTMLElement,
    cards: HTMLElement[],
    to: { col: number; row: number },
  ) => {
    if (typeof board.querySelectorAll !== "function" || !cards[0]?.dataset?.col)
      return cards[cellIndex(columns, to)];
    const inColumn = cards.filter((c) => Number(c.dataset.col) === to.col);
    // A card that is outside the rendered window is not in the page: use the nearest one that is.
    return inColumn.reduce<HTMLElement | undefined>(
      (best, c) =>
        !best ||
        Math.abs(Number(c.dataset.row) - to.row) <
          Math.abs(Number(best.dataset.row) - to.row)
          ? c
          : best,
      undefined,
    );
  };
  // Arrows, Home and End move focus between cards. Only a key typed on a card is looked at, and only a handled key is consumed.
  const onBoardKey = (event: KeyboardEvent<HTMLElement>) => {
    const cards = cardsOf(event.currentTarget);
    if (cards.indexOf(event.target as HTMLElement) < 0) return;
    const to = moveFocus(
      columns,
      cellOfCard(event.target as HTMLElement, cards),
      event,
    );
    if (!to) return;
    event.preventDefault();
    const next = cardAtCell(event.currentTarget, cards, to);
    if (next && next !== event.target) next.focus();
  };
  const onBoardFocus = (event: FocusEvent<HTMLElement>) => {
    const cards = cardsOf(event.currentTarget);
    const card = event.target as HTMLElement;
    const next = stopAt(
      columns,
      cards.indexOf(card) < 0 ? null : cellOfCard(card, cards),
    );
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
          placeholder="Search title, owner, state or id…"
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
        <select
          aria-label="Group tasks by"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value === "seat" ? "seat" : "state")}
        >
          <option value="state">Group by state</option>
          <option value="seat">Group by seat</option>
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
              key={column.key}
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
              <VirtualList
                rows={column.items}
                scopeKey={JSON.stringify([taskScope, column.key, filters, groupBy])}
                itemKey={(item) => JSON.stringify([taskScope, "task", item.id])}
                label={
                  groupBy === "seat"
                    ? `Tasks for ${column.label}`
                    : column.key === "other"
                      ? "Other-state tasks"
                      : `${column.key[0].toUpperCase()}${column.key.slice(1)} tasks`
                }
                maxHeight={360}
                className="task-card-viewport"
                renderRow={(item, row) => (
                  <button
                    className="task-card"
                    key={item.id}
                    onClick={() => inspect(item)}
                    tabIndex={tabFor(col, row)}
                    data-col={col}
                    data-row={row}
                    data-stuck={isStuck(item, now) ? "true" : undefined}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.destination}</span>
                    {reasonNote(item)}
                    <small className="badge">{item.status}</small>
                    {ageNote(item)}
                  </button>
                )}
              />
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
          {create && prepared && (
            <p className="field-note" role="status">
              {reviewNote(prepared)}
            </p>
          )}
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
          {!create && detail && onFile && root && (
            <TaskFileReferences
              detail={detail}
              connection={connection}
              root={root}
              onFile={onFile}
            />
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
          {create && prepared && ownerHint(prepared, seats) && (
            <p className="field-note">{ownerHint(prepared, seats)}</p>
          )}
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
