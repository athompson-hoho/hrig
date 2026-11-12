import { Fragment, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { ErrorBox, Modal } from "./components";
import { isHelpKey, shortcutGroups } from "./shortcuts";
import {
  OVERRIDABLE_IDS,
  applyOverrides,
  chordLabel,
  defaultChord,
  filterShortcutGroups,
  parseOverrideText,
  resetOverride,
  saveOverride,
  type OverridableId,
} from "./shortcut-overrides";

/**
 * Overlay listing the keyboard shortcuts with the keys now in use. Rebindable
 * rows can be given other keys, typed in a small field and checked for clashes
 * before anything is saved, and put back with Reset. Closed by
 * Escape, the close button, a backdrop click or a bare question mark. Sends
 * nothing anywhere.
 */
export default function ShortcutSheet({
  platform,
  overrides,
  onSave,
  onClose,
}: {
  platform: string;
  overrides: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(
    null,
  );
  const [error, setError] = useState("");
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
  const parsed = parseOverrideText(overrides, platform);
  const groups = filterShortcutGroups(
    applyOverrides(shortcutGroups(platform), parsed.map, platform),
    query,
  );
  const rebindable = (id: string) =>
    (OVERRIDABLE_IDS as readonly string[]).includes(id);
  const stop = () => {
    setEditing(null);
    setError("");
  };
  const save = () => {
    if (editing === null) return;
    const result = saveOverride(overrides, editing.id, editing.draft, platform);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSave(result.text);
    stop();
  };
  const ignored = parsed.ignored;
  return (
    <Modal
      title="Keyboard shortcuts"
      subtitle="Press Escape to close. Edit a shortcut to change its keys; clashes and operating-system shortcuts are refused."
      onClose={onClose}
      wide
    >
      <label className="settings-search">
        <Search size={15} />
        <input
          aria-label="Search shortcuts"
          placeholder="Search shortcuts by name or keys"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "?" && query === "") {
              event.preventDefault();
              onClose();
            }
          }}
        />
      </label>
      {error && <ErrorBox error={error} />}
      {ignored.length > 0 && (
        <p className="field-note">
          Saved shortcut text that is ignored:{" "}
          {ignored
            .slice(0, 3)
            .map((item) => item.entry + " (" + item.reason + ")")
            .join(" ")}
          {ignored.length > 3 ? " And " + (ignored.length - 3) + " more." : ""}
        </p>
      )}
      {groups.length === 0 && (
        <p className="field-note">No shortcut matches.</p>
      )}
      {groups.map((group) => (
        <section key={group.id}>
          <h3 className="palette-section-label">{group.title.toUpperCase()}</h3>
          <dl className="settings-shortcuts">
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.id}>
                <dt>{shortcut.label}</dt>
                <dd>
                  {editing !== null && editing.id === shortcut.id ? (
                    <>
                      <input
                        aria-label={"New keys for " + shortcut.label}
                        placeholder={chordLabel(
                          defaultChord(shortcut.id as OverridableId),
                          platform,
                        )}
                        value={editing.draft}
                        autoFocus
                        onChange={(event) =>
                          setEditing({
                            id: shortcut.id,
                            draft: event.target.value,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            save();
                          } else if (event.key === "Escape") {
                            event.stopPropagation();
                            stop();
                          }
                        }}
                      />{" "}
                      <button className="small-button" onClick={save}>
                        Save
                      </button>{" "}
                      <button className="small-button" onClick={stop}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {shortcut.keys.map((key, index) => (
                        <Fragment key={key}>
                          {index > 0 && " or "}
                          <kbd>{key.replace(/^Control\+/, "Ctrl+")}</kbd>
                        </Fragment>
                      ))}
                      {rebindable(shortcut.id) && (
                        <>
                          {" "}
                          <button
                            className="small-button"
                            aria-label={"Edit keys for " + shortcut.label}
                            onClick={() => {
                              setError("");
                              setEditing({
                                id: shortcut.id,
                                  draft: chordLabel(
                                    parsed.map[shortcut.id as OverridableId] ??
                                      defaultChord(shortcut.id as OverridableId),
                                    platform,
                                  ),
                              });
                            }}
                          >
                            Edit
                          </button>
                          {parsed.map[shortcut.id as OverridableId] !==
                            undefined && (
                            <>
                              {" "}
                              <button
                                className="small-button"
                                aria-label={"Reset " + shortcut.label}
                                title={
                                  "Back to " +
                                  chordLabel(
                                    defaultChord(shortcut.id as OverridableId),
                                    platform,
                                  )
                                }
                                onClick={() => {
                                  onSave(
                                    resetOverride(
                                      overrides,
                                      shortcut.id,
                                      platform,
                                    ),
                                  );
                                  stop();
                                }}
                              >
                                Reset
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {overrides !== "" && (
        <div className="modal-actions">
          <button
            className="small-button"
            onClick={() => {
              onSave("");
              stop();
            }}
          >
            Reset all
          </button>
        </div>
      )}
    </Modal>
  );
}
