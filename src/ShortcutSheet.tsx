import { Fragment, useEffect } from "react";
import { Modal } from "./components";
import { isHelpKey, shortcutGroups } from "./shortcuts";

/**
 * Read-only overlay listing the keyboard shortcuts. Closed by Escape, the close
 * button, a backdrop click or a bare question mark. Sends nothing anywhere.
 */
export default function ShortcutSheet({
  platform,
  onClose,
}: {
  platform: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isHelpKey(event, event.target, false)) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <Modal
      title="Keyboard shortcuts"
      subtitle="Press ? or Escape to close. This list is read-only."
      onClose={onClose}
      wide
    >
      {shortcutGroups(platform).map((group) => (
        <section key={group.id}>
          <h3 className="palette-section-label">{group.title.toUpperCase()}</h3>
          <dl className="settings-shortcuts">
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.id}>
                <dt>{shortcut.label}</dt>
                <dd>
                  {shortcut.keys.map((key, index) => (
                    <Fragment key={key}>
                      {index > 0 && " or "}
                      <kbd>{key}</kbd>
                    </Fragment>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Modal>
  );
}
