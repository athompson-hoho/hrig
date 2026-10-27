import { useEffect, useRef, useState } from "react";
import {
  Settings2,
  Search,
  RotateCcw,
  Palette,
  Code2,
  TerminalSquare,
  LayoutGrid,
  Network,
  Bell,
  Keyboard,
  Info,
  FileJson,
  Download,
  Upload,
  Check,
} from "lucide-react";
import { useSettings } from "./SettingsContext";
import {
  defaults,
  schema,
  validateOverrides,
  type Setting,
  type SettingsScope,
} from "./settings";
import { themes } from "./themes";
import { Modal, ErrorBox } from "./components";
import { version } from "../package.json";
const categories = [
  ["Appearance", Palette],
  ["Editor", Code2],
  ["Terminal", TerminalSquare],
  ["Workspace", LayoutGrid],
  ["Connections & rigs", Network],
  ["Notifications", Bell],
  ["Keyboard shortcuts", Keyboard],
  ["About", Info],
] as const;
function Row({ row, scope }: { row: Setting; scope: SettingsScope }) {
  const context = useSettings(),
    own = scope === "user" ? context.user : context.project;
  const value =
    own[row.key] ??
    (scope === "project" ? context.user[row.key] : undefined) ??
    defaults[row.key];
  const [draft, setDraft] = useState(String(value)),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(String(value));
    setError("");
  }, [value, scope]);
  const commit = (next: unknown) => {
    try {
      validateOverrides({ [row.key]: next });
      context.update(scope, row.key, next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const modified = Object.hasOwn(own, row.key);
  return (
    <div
      className={`setting-row ${modified ? "modified" : ""}`}
      data-setting={row.key}
    >
      <div className="setting-copy">
        <label htmlFor={"setting-" + row.key}>{row.label}</label>
        <p>{row.description}</p>
        <code>{row.key}</code>
        {modified && (
          <span className="setting-badge">
            {scope === "project" ? "Project override" : "Modified"}
          </span>
        )}
      </div>
      <div className="setting-control">
        {typeof value === "boolean" ? (
          <label className="setting-toggle">
            <input
              id={"setting-" + row.key}
              type="checkbox"
              checked={value}
              onChange={(e) => commit(e.target.checked)}
            />
            <span>{value ? "On" : "Off"}</span>
          </label>
        ) : row.options ? (
          <select
            id={"setting-" + row.key}
            value={String(value)}
            onChange={(e) =>
              commit(
                typeof defaults[row.key] === "number"
                  ? Number(e.target.value)
                  : e.target.value,
              )
            }
          >
            {row.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={"setting-" + row.key}
            type={typeof value === "number" ? "number" : "text"}
            value={draft}
            min={row.min}
            max={row.max}
            step={row.step ?? 1}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() =>
              commit(
                typeof value === "number"
                  ? draft.trim()
                    ? Number(draft)
                    : NaN
                  : draft,
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        )}
        <button
          className="setting-reset"
          title={
            scope === "project" ? "Remove project override" : "Reset to default"
          }
          aria-label={"Reset " + row.label}
          disabled={!modified}
          onClick={() => context.reset(scope, row.key)}
        >
          <RotateCcw size={13} />
        </button>
        {error && (
          <span className="setting-validation" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
export default function SettingsPage({ project }: { project: string }) {
  const context = useSettings();
  const [category, setCategory] = useState("Appearance"),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState<SettingsScope>("user"),
    [modifiedOnly, setModifiedOnly] = useState(false),
    [confirmReset, setConfirmReset] = useState(false),
    [json, setJson] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const file = useRef<HTMLInputElement>(null),
    own = scope === "user" ? context.user : context.project;
  const text = query.trim().toLowerCase();
  const matches = schema.filter(
    (row) =>
      (text
        ? `${row.key} ${row.label} ${row.description} ${row.category} ${row.options?.map((o) => o.label + " " + o.value).join(" ") || ""}`
            .toLowerCase()
            .includes(text)
        : row.category === category) &&
      (!modifiedOnly || Object.hasOwn(own, row.key)),
  );
  const value =
    own["appearance.theme"] ??
    (scope === "project" ? context.user["appearance.theme"] : undefined) ??
    defaults["appearance.theme"];
  useEffect(() => {
    if (category === "JSON") {
      setJson(
        JSON.stringify(
          {
            version: 1,
            settings: scope === "user" ? context.user : context.project,
          },
          null,
          2,
        ),
      );
      setError("");
    }
  }, [scope]);
  const openJson = () => {
    setCategory("JSON");
    setQuery("");
    setError("");
    setJson(JSON.stringify({ version: 1, settings: own }, null, 2));
  };
  return (
    <div className="settings-page">
      <header className="settings-heading">
        <Settings2 size={19} />
        <div>
          <h2>Settings</h2>
          <p>Customize your HRig workspace. Changes save automatically.</p>
        </div>
        <button className="secondary-button" onClick={openJson}>
          <FileJson size={14} /> Settings JSON
        </button>
      </header>
      <div className="settings-toolbar">
        <label className="settings-search">
          <Search size={15} />
          <input
            aria-label="Search settings"
            placeholder="Search settings by name, feature, or key"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              aria-label="Clear settings search"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={modifiedOnly}
            onChange={(e) => setModifiedOnly(e.target.checked)}
          />{" "}
          Modified only
        </label>
      </div>
      <div className="settings-scopes" role="group" aria-label="Settings scope">
        <button
          className={scope === "user" ? "selected" : ""}
          aria-pressed={scope === "user"}
          onClick={() => {
            setScope("user");
            setNotice("");
          }}
        >
          User
        </button>
        <button
          className={scope === "project" ? "selected" : ""}
          aria-pressed={scope === "project"}
          onClick={() => {
            setScope("project");
            setNotice("");
          }}
        >
          Project
        </button>
        <span title={project}>
          {scope === "user"
            ? "Applies to every project unless overridden"
            : project}
        </span>
        <button
          className="settings-reset-scope"
          disabled={!Object.keys(own).length}
          onClick={() => setConfirmReset(true)}
        >
          <RotateCcw size={12} /> Reset {scope} settings
        </button>
      </div>
      <div className="settings-layout">
        <nav aria-label="Settings categories">
          {categories.map(([name, Icon]) => (
            <button
              key={name}
              aria-label={name}
              title={name}
              className={category === name && !query ? "selected" : ""}
              aria-current={category === name && !query ? "page" : undefined}
              onClick={() => {
                setCategory(name);
                setQuery("");
                setError("");
              }}
            >
              <Icon size={15} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <main className="settings-content">
          <p className="settings-scope-note">
            {scope === "project"
              ? "Project overrides are saved locally in HRig for this connection and folder. Reset a row to inherit your user setting."
              : "User settings are saved on this computer. Project overrides take precedence."}
          </p>
          {notice && (
            <p className="settings-notice" role="status">
              <Check size={13} />
              {notice}
            </p>
          )}
          {query || schema.some((r) => r.category === category) ? (
            <>
              <div className="settings-section-title">
                <h3>{query ? "Search results" : category}</h3>
                <span>{matches.length} settings</span>
              </div>
              {!query && category === "Appearance" && !modifiedOnly && (
                <>
                  {["Built-in", "Community"].map((group) => (
                    <section className="theme-collection" key={group}>
                      <h4>{group} themes</h4>
                      <div
                        className="theme-picker"
                        role="group"
                        aria-label={group + " theme previews"}
                      >
                        {Object.entries(themes)
                          .filter(
                            ([, theme]) =>
                              (theme.family === "Community") ===
                              (group === "Community"),
                          )
                          .map(([id, theme]) => (
                            <button
                              key={id}
                              title={
                                theme.family === "Community"
                                  ? "HRig adaptation of " + theme.name
                                  : theme.name
                              }
                              aria-label={"Use " + theme.name + " theme"}
                              aria-pressed={value === id}
                              className={value === id ? "selected" : ""}
                              onClick={() =>
                                context.update(scope, "appearance.theme", id)
                              }
                            >
                              <span
                                className="theme-preview"
                                style={{
                                  background: theme.background,
                                  color: theme.text,
                                  borderColor: theme.line,
                                }}
                              >
                                <i style={{ background: theme.line }} />
                                <b style={{ background: theme.panel }}>
                                  <em
                                    style={{
                                      background:
                                        theme.syntax?.keyword || theme.muted,
                                    }}
                                  />
                                  <em
                                    style={{
                                      background:
                                        theme.syntax?.string || theme.text,
                                    }}
                                  />
                                  <em
                                    style={{
                                      background: theme.accent || theme.muted,
                                    }}
                                  />
                                </b>
                              </span>
                              <strong>{theme.name}</strong>
                              {value === id && <Check size={12} />}
                            </button>
                          ))}
                      </div>
                    </section>
                  ))}
                  <p className="theme-credits-note">
                    Community palettes are bundled offline with theme-specific
                    editor and terminal colors.{" "}
                    <a
                      href="https://github.com/athompson-hoho/hrig/blob/master/THEME_CREDITS.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Credits and licenses
                    </a>
                  </p>
                </>
              )}
              {matches.map((row) => (
                <Row key={scope + row.key} row={row} scope={scope} />
              ))}
              {!matches.length && (
                <div className="settings-empty">
                  <Search size={23} />
                  <h3>No matching settings</h3>
                  <p>Try a different keyword or turn off Modified only.</p>
                </div>
              )}
            </>
          ) : category === "JSON" ? (
            <section className="settings-json">
              <h3>Settings JSON</h3>
              <p>
                Import or export preferences for the selected scope. Saved
                connections, credentials, and layouts are not exported. Applying
                JSON replaces only this scope's preferences.
              </p>
              <div className="arrange-controls">
                <button
                  className="secondary-button"
                  onClick={() => file.current?.click()}
                >
                  <Upload size={13} /> Import file
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    const content = JSON.stringify(
                      { version: 1, settings: own },
                      null,
                      2,
                    );
                    setJson(content);
                    const url = URL.createObjectURL(
                      new Blob([content], { type: "application/json" }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "hrig-" + scope + "-settings.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <Download size={13} /> Export JSON
                </button>
              </div>
              <input
                type="file"
                accept="application/json,.json"
                hidden
                ref={file}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    if (f.size > 65536)
                      throw Error("Settings files must be smaller than 64 KB.");
                    setJson(await f.text());
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                  e.target.value = "";
                }}
              />
              <label className="field-label">
                JSON
                <textarea
                  aria-label="Settings JSON"
                  spellCheck={false}
                  rows={18}
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                />
              </label>
              {error && <ErrorBox error={error} />}
              <button
                className="primary-button"
                onClick={() => {
                  try {
                    if (json.length > 65536)
                      throw Error("Settings JSON must be smaller than 64 KB.");
                    const parsed = JSON.parse(json);
                    if (parsed.version !== 1 || !parsed.settings)
                      throw Error("Expected version: 1 and a settings object.");
                    const next = validateOverrides(parsed.settings);
                    context.replace(scope, next);
                    setError("");
                    setNotice(
                      "Applied " +
                        Object.keys(next).length +
                        " settings to " +
                        scope +
                        " scope.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Apply JSON
              </button>
            </section>
          ) : category === "Keyboard shortcuts" ? (
            <section className="settings-shortcuts">
              <h3>Keyboard shortcuts</h3>
              <p>
                Built-in workspace shortcuts. Terminal and editor applications
                also handle their own keybindings.
              </p>
              {[
                ["Ctrl ,", "Open settings"],
                ["Ctrl K", "Open command center"],
                ["Ctrl O", "Choose project folder"],
                ["Ctrl B", "Toggle sidebar"],
                ["Ctrl Shift T", "New shell"],
                ["Ctrl S", "Save editor file"],
              ].map(([key, label]) => (
                <div key={key}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </section>
          ) : (
            <section className="settings-about">
              <h3>HRig {version}</h3>
              <p>A graphical Windows workspace for OpenRig over WSL and SSH.</p>
              <p>
                Settings and locally stored project overrides live in the HRig
                application-data directory alongside workspace.json.
                Import/export includes preferences only.
              </p>
              <p>
                OpenRig owns agent permissions, models, task policy, and runtime
                authentication. These preferences do not alter agent policy or
                start, stop, or delete rigs.
              </p>
              <p>
                Updates:{" "}
                <a
                  href="https://github.com/athompson-hoho/hrig/releases"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub releases
                </a>
              </p>
            </section>
          )}
        </main>
      </div>
      {confirmReset && (
        <Modal
          title={"Reset " + scope + " settings?"}
          subtitle={
            scope === "user"
              ? "Restore default user preferences. Project overrides remain."
              : "Remove these project overrides and inherit user preferences."
          }
          onClose={() => setConfirmReset(false)}
        >
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setConfirmReset(false)}
            >
              Cancel reset
            </button>
            <button
              className="primary-button"
              onClick={() => {
                context.reset(scope);
                setConfirmReset(false);
                setNotice("Reset " + scope + " settings.");
              }}
            >
              Reset settings
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
