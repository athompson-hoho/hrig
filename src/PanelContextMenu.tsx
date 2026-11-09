import { useEffect, useState } from "react";
import { Modal } from "./components";
import {
  planClose,
  type ClosePlan,
  type CloseScope,
  type PanelInfo,
} from "./panel-close-targets";

/** Where the menu opens and the tabs of the clicked tab's group, in strip order. */
export interface PanelMenu {
  x: number;
  y: number;
  id: string;
  panels: PanelInfo[];
}

const ITEMS: { scope: CloseScope; label: string }[] = [
  { scope: "self", label: "Close" },
  { scope: "others", label: "Close others" },
  { scope: "right", label: "Close to the right" },
];

/**
 * The right-click menu of a panel tab. It only chooses which panels to close:
 * onClosePanels receives the ids and closes them through the app's own close
 * and unsaved-edits flow, after a confirmation when more than one panel or
 * any terminal would close. For a terminal panel it also offers Rename and,
 * once renamed, Reset name: the typed text goes to onRenamePanel as it is and
 * the app cleans it, so a title is only ever a label.
 */
export default function PanelContextMenu({
  menu,
  renamed = false,
  onDismiss,
  onClosePanels,
  onRenamePanel,
  onResetPanel,
}: {
  menu: PanelMenu | null;
  renamed?: boolean;
  onDismiss: () => void;
  onClosePanels: (ids: string[]) => void;
  onRenamePanel: (id: string, text: string) => void;
  onResetPanel: (id: string) => void;
}) {
  const [ask, setAsk] = useState<ClosePlan | null>(null);
  const [rename, setRename] = useState<{ id: string; text: string } | null>(
    null,
  );
  useEffect(() => {
    if (!menu) return;
    const key = (event: KeyboardEvent) => event.key === "Escape" && onDismiss();
    window.addEventListener("mousedown", onDismiss);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", onDismiss);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  const choose = (scope: CloseScope) => {
    if (!menu) return;
    const plan = planClose(menu.panels, scope, menu.id);
    onDismiss();
    if (plan.order.length === 0) return;
    if (plan.confirm) setAsk(plan);
    else onClosePanels(plan.order);
  };
  const clickedId = menu?.id;
  const clicked = menu?.panels.find((panel) => panel.id === clickedId);
  const titled = clicked?.kind === "seat" || clicked?.kind === "shell";
  const startRename = () => {
    if (!menu) return;
    onDismiss();
    setRename({ id: menu.id, text: clicked ? clicked.name : "" });
  };
  const resetName = () => {
    if (!menu) return;
    onDismiss();
    onResetPanel(menu.id);
  };
  const saveRename = () => {
    const done = rename;
    setRename(null);
    if (done) onRenamePanel(done.id, done.text);
  };
  return (
    <>
      {menu && (
        <div
          className="dropdown terminal-context-menu"
          role="menu"
          aria-label="Panel"
          style={{
            left: Math.min(menu.x, window.innerWidth - 180),
            top: Math.min(
              menu.y,
              window.innerHeight - 130 - (titled ? (renamed ? 77 : 44) : 0),
            ),
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {ITEMS.map((item) => (
            <button
              key={item.scope}
              role="menuitem"
              disabled={
                planClose(menu.panels, item.scope, menu.id).order.length === 0
              }
              onClick={() => choose(item.scope)}
            >
              <span>{item.label}</span>
            </button>
          ))}
          {titled && <div className="menu-separator" />}
          {titled && (
            <button role="menuitem" onClick={startRename}>
              <span>Rename...</span>
            </button>
          )}
          {titled && renamed && (
            <button role="menuitem" onClick={resetName}>
              <span>Reset name</span>
            </button>
          )}
        </div>
      )}
      {rename && (
        <Modal
          title="Rename panel"
          subtitle="Only the tab title changes. The session and the seat are not touched."
          onClose={() => setRename(null)}
        >
          <label className="field-label">
            PANEL NAME
            <input
              aria-label="Panel name"
              value={rename.text}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) =>
                setRename({ id: rename.id, text: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing)
                  saveRename();
              }}
            />
          </label>
          <p className="field-note">
            Up to 60 characters. Leave it empty to restore the original name.
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setRename(null)}
            >
              Cancel
            </button>
            <button className="primary-button" onClick={saveRename}>
              Rename
            </button>
          </div>
        </Modal>
      )}
      {ask && (
        <Modal
          title={ask.title}
          subtitle={ask.description}
          onClose={() => setAsk(null)}
        >
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setAsk(null)}>
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setAsk(null);
                onClosePanels(ask.order);
              }}
            >
              {ask.panels === 1
                ? "Close 1 panel"
                : "Close " + ask.panels + " panels"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
