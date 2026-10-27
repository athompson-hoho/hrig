import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Search,
  Columns2,
  ExternalLink,
  FileCode2,
  TerminalSquare,
} from "lucide-react";
import { Modal } from "./components";
import { fuzzyScore } from "../electron/fuzzy.mjs";
export interface NavigablePanel {
  id: string;
  name: string;
  component: string;
  host: string;
  root: string;
  rig: string;
  seat: string;
  path: string;
  group: string;
  detached: boolean;
  dirty: boolean;
}
export default function PanelNavigator({
  panels,
  recent,
  groups,
  onFocus,
  onMove,
  onClose,
}: {
  panels: NavigablePanel[];
  recent: string[];
  groups: { id: string; name: string }[];
  onFocus: (id: string) => void;
  onMove: (id: string, target: string, direction: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0),
    [target, setTarget] = useState(groups[0]?.id || "");
  const list = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () =>
      panels
        .map((panel) => ({
          panel,
          score: fuzzyScore(
            `${panel.name} ${panel.host} ${panel.rig} ${panel.seat} ${panel.path} ${panel.root} ${panel.group}`,
            query,
          ),
        }))
        .filter((item) => item.score !== null)
        .sort((a, b) =>
          query
            ? b.score! - a.score!
            : (recent.indexOf(a.panel.id) + 1 || 999) -
              (recent.indexOf(b.panel.id) + 1 || 999),
        )
        .map((item) => item.panel),
    [panels, query, recent],
  );
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const active = items[Math.min(selected, items.length - 1)];
  return (
    <Modal
      title="Open panels"
      subtitle="Find existing panels in this workspace, including detached windows. No duplicate sessions."
      onClose={onClose}
      wide
    >
      <div
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (
            e.altKey &&
            active &&
            (e.target as HTMLElement).tagName !== "SELECT"
          ) {
            const directions: Record<string, string> = {
              ArrowLeft: "left",
              ArrowRight: "right",
              ArrowDown: "bottom",
              Enter: "center",
            };
            if (directions[e.key] && target) {
              e.preventDefault();
              onMove(active.id, target, directions[e.key]);
            }
          }
        }}
      >
        <label className="navigation-search">
          <Search size={17} />
          <input
            aria-label="Search open panels"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            placeholder="Find a seat, file, rig, host or group…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-controls="panel-navigator-results"
            aria-activedescendant={
              active
                ? "open-panel-" + Math.min(selected, items.length - 1)
                : undefined
            }
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.altKey) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (items.length)
                  setSelected(
                    (i) =>
                      (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                      items.length,
                  );
              }
              if (e.key === "Enter" && active) {
                e.preventDefault();
                onFocus(active.id);
              }
            }}
          />
          <kbd>
            {window.hrig.platform === "darwin" ? "Cmd Shift P" : "Ctrl Shift P"}
          </kbd>
        </label>
        <div className="navigation-status">
          {items.length} open {items.length === 1 ? "panel" : "panels"} ·{" "}
          {query ? "Best matches" : "Most recently used first"}
        </div>
        <div
          ref={list}
          className="navigation-results"
          id="panel-navigator-results"
          role="listbox"
          aria-label="Open workspace panels"
        >
          {items.map((panel, index) => (
            <button
              id={"open-panel-" + index}
              key={panel.id}
              role="option"
              aria-selected={active?.id === panel.id}
              onMouseEnter={() => setSelected(index)}
              onClick={() => onFocus(panel.id)}
            >
              {panel.component === "terminal" ? (
                <TerminalSquare size={17} />
              ) : (
                <FileCode2 size={17} />
              )}
              <span>
                <strong>
                  {panel.name}
                  {panel.dirty ? " · unsaved" : ""}
                </strong>
                <small>
                  {[panel.host, panel.rig, panel.seat, panel.path || panel.root]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <small>
                  {panel.group}
                  {panel.detached ? " · Detached window" : ""}
                </small>
              </span>
              {panel.detached ? (
                <ExternalLink size={14} />
              ) : (
                <ArrowUpRight size={14} />
              )}
            </button>
          ))}
          {!items.length && (
            <div className="navigation-empty">
              <Columns2 size={25} />
              <strong>No matching panels</strong>
              <p>Try a different seat, file, host or group name.</p>
            </div>
          )}
        </div>
        <div className="navigator-move">
          <label className="field-label">
            MOVE SELECTED PANEL TO
            <select
              aria-label="Panel destination group"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {groups.map((g) => (
                <option value={g.id} key={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            {[
              ["center", "Group as tab (Alt Enter)"],
              ["left", "Split left (Alt Left)"],
              ["right", "Split right (Alt Right)"],
              ["bottom", "Split below (Alt Down)"],
            ].map(([direction, label]) => (
              <button
                className="small-button"
                key={direction}
                disabled={!active || !groups.some((g) => g.id === target)}
                onClick={() => active && onMove(active.id, target, direction)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="navigation-hint">
          ↑ ↓ choose · Enter focuses · Escape cancels. Move/split actions can be
          undone in Arrange.
        </p>
      </div>
    </Modal>
  );
}
