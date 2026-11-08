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
 * any terminal would close.
 */
export default function PanelContextMenu({
  menu,
  onDismiss,
  onClosePanels,
}: {
  menu: PanelMenu | null;
  onDismiss: () => void;
  onClosePanels: (ids: string[]) => void;
}) {
  const [ask, setAsk] = useState<ClosePlan | null>(null);
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
  return (
    <>
      {menu && (
        <div
          className="dropdown terminal-context-menu"
          role="menu"
          aria-label="Panel"
          style={{
            left: Math.min(menu.x, window.innerWidth - 180),
            top: Math.min(menu.y, window.innerHeight - 130),
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
        </div>
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
