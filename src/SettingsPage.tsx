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
import { analyzeSettingsImport, summarizeImport } from "./settings-transfer";
import {
  defaults,
  schema,
  validateOverrides,
  type Setting,
  type SettingsScope,
} from "./settings";
import { themes } from "./themes";
import { overrideNote, summarizeOverrides } from "./settings-overrides";
import { recentRows } from "./settings-recent";
import {
  describeSectionReset,
  highlightParts,
  modifiedKeysInCategory,
} from "./settings-view";
import { Modal, ErrorBox } from "./components";
import { version } from "../package.json";
import UpdateSettings from './UpdateSettings';
import MobileDevices from "./MobileDevices";
const categories = [
  ["Appearance", Palette],
  ["Editor", Code2],
  ["Terminal", TerminalSquare],
  ["Workspace", LayoutGrid],
  ["Connections & rigs", Network],
  ["Mobile devices", Network],
  ["Notifications", Bell],
  ["Keyboard shortcuts", Keyboard],
  ['Updates', Download],
  ["About", Info],
] as const;
// A row's text with the searched words marked: plain text and mark elements, never markup.
function marked(text: string, query: string) {
  const parts = highlightParts(text, query);
  if (!parts.some((part) => part.match)) return text;
  return parts.map((part, i) =>
    part.match ? <mark key={i}>{part.text}</mark> : part.text,
  );
}
function Row({
  row,
  scope,
  highlight,
}: {
  row: Setting;
  scope: SettingsScope;
  highlight: string;
}) {
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
  const note =
    scope === "user" ? overrideNote(row, context.user, context.project) : null;
  return (
    <div
      className={`setting-row ${modified ? "modified" : ""}`}
      data-setting={row.key}
    >
      <div className="setting-copy">
        <label htmlFor={"setting-" + row.key}>
          {marked(row.label, highlight)}
        </label>
        <p>{marked(row.description, highlight)}</p>
        <code>{row.key}</code>
        {modified && (
          <span className="setting-badge">
            {scope === "project" ? "Project override" : "Modified"}
          </span>
        )}
        {note && (
          <span
            className="setting-badge"
            data-override={note.state}
            title={note.title}
          >
            {note.text}
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
    [recentOnly, setRecentOnly] = useState(false),
    [confirmReset, setConfirmReset] = useState(false),
    [confirmSection, setConfirmSection] = useState(""),
    [json, setJson] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const file = useRef<HTMLInputElement>(null),
    own = scope === "user" ? context.user : context.project;
  const summary = summarizeOverrides(context.user, context.project);
  const text = query.trim().toLowerCase();
  const recent = recentRows(schema, context.recent, scope);
  const found = schema.filter(
    (row) =>
      (text
        ? `${row.key} ${row.label} ${row.description} ${row.category} ${row.options?.map((o) => o.label + " " + o.value).join(" ") || ""}`
            .toLowerCase()
            .includes(text)
        : recentOnly || row.category === category) &&
      (!modifiedOnly || Object.hasOwn(own, row.key)),
  );
  const matches = recentOnly
    ? recent.filter((row) => found.includes(row))
    : found;
  const listing = !!query || recentOnly;
  const sectionKeys = modifiedKeysInCategory(
    schema,
    own,
    confirmSection || category,
  );
  const sectionReset = describeSectionReset(
    scope,
    confirmSection || category,
    sectionKeys,
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
    setRecentOnly(false);
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
        <label
          className="checkbox-label"
          title={
            recent.length || recentOnly
              ? "Show the settings changed since HRig started, newest first"
              : "Nothing has changed in the " +
                scope +
                " scope since HRig started"
          }
        >
          <input
            type="checkbox"
            checked={recentOnly}
            disabled={!recent.length && !recentOnly}
            onChange={(e) => setRecentOnly(e.target.checked)}
          />{" "}
          Recently changed
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
              className={category === name && !listing ? "selected" : ""}
              aria-current={category === name && !listing ? "page" : undefined}
              onClick={() => {
                setCategory(name);
                setQuery("");
                setRecentOnly(false);
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
            {category === "Mobile devices" ? "Mobile access and device approvals apply to this computer, across all projects." : scope === "project"
              ? "Project overrides are saved locally in HRig for this connection and folder. Reset a row to inherit your user setting."
              : "User settings are saved on this computer. Project overrides take precedence."}
          </p>
          {summary.text && (
            <p
              className="settings-scope-note"
              data-overrides={summary.count}
              title={summary.title}
            >
              {summary.text}
            </p>
          )}
          {notice && (
            <p className="settings-notice" role="status">
              <Check size={13} />
              {notice}
            </p>
          )}
          {category==='Updates' && !listing ? <UpdateSettings /> : category === "Mobile devices" && !listing ? <MobileDevices /> : listing || schema.some((r) => r.category === category) ? (
            <>
              <div className="settings-section-title">
                <h3>
                  {query
                    ? "Search results"
                    : recentOnly
                      ? "Recently changed"
                      : category}
                </h3>
                <span>{matches.length} settings</span>
                {!listing && (
                  <button
                    className="settings-reset-scope"
                    disabled={!sectionReset.count}
                    title={sectionReset.buttonTitle}
                    onClick={() => setConfirmSection(category)}
                  >
                    <RotateCcw size={12} /> {sectionReset.button}
                  </button>
                )}
              </div>
              {!listing && category === "Appearance" && !modifiedOnly && (
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
                <Row
                  key={scope + row.key}
                  row={row}
                  scope={scope}
                  highlight={text}
                />
              ))}
              {!matches.length && (
                <div className="settings-empty">
                  <Search size={23} />
                  <h3>No matching settings</h3>
                  <p>
                    Try a different keyword or turn off Modified only or
                    Recently changed.
                  </p>
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
              {(() => {
                const report = analyzeSettingsImport(json, own);
                return (
                  <div className="settings-import-report" role="status" aria-label="Import check">
                    <strong>Check before applying ({scope} scope): </strong>
                    {summarizeImport(report)}
                    {report.notes.map((n) => <p key={n} className="subtle">{n}</p>)}
                    {report.skipped.length > 0 && (
                      <ul>
                        {report.skipped.slice(0, 10).map((s) => <li key={s.key}><code>{s.key}</code>: {s.reason}</li>)}
                        {report.skipped.length > 10 && <li>…and {report.skipped.length - 10} more</li>}
                      </ul>
                    )}
                    {report.removed.length > 0 && <p className="subtle">Applying replaces this scope, so these current settings will be removed: {report.removed.slice(0, 10).join(", ")}{report.removed.length > 10 ? "…" : ""}</p>}
                  </div>
                );
              })()}
              <button
                className="primary-button"
                disabled={!!analyzeSettingsImport(json, own).fatal}
                onClick={() => {
                  const report = analyzeSettingsImport(json, own);
                  if (report.fatal) {
                    setError(report.fatal);
                    return;
                  }
                  context.replace(scope, report.valid);
                  setError("");
                  setNotice(
                    "Applied " + Object.keys(report.valid).length + " settings to " + scope + " scope" +
                      (report.skipped.length ? "; skipped " + report.skipped.length + "." : "."),
                  );
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
              <p>Press ? outside a text field, the editor or a terminal, or run Open keyboard shortcuts in the command center, for the full list with the keys for your platform.</p>
              {[
                ["Ctrl ,", "Open settings"],
                ["Ctrl K", "Open command center"],
                ["Ctrl O", "Choose project folder"],
                ["Ctrl P", "Quick Open project file"],
                ["Ctrl Shift P", "Find open panels"],
                ["Ctrl B", "Toggle sidebar"],
                ["Ctrl Shift T", "New shell"],
                ["Ctrl Shift K", "Clear focused terminal scrollback (Cmd K on macOS)"],
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
              <p>A graphical desktop workspace for local, WSL and SSH OpenRig hosts.</p>
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
      {confirmSection && (
        <Modal
          title={sectionReset.title}
          subtitle={sectionReset.subtitle}
          onClose={() => setConfirmSection("")}
        >
          {sectionReset.detail && (
            <p className="settings-scope-note">{sectionReset.detail}</p>
          )}
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setConfirmSection("")}
            >
              Cancel reset
            </button>
            <button
              className="primary-button"
              disabled={!sectionReset.count}
              onClick={() => {
                for (const key of sectionKeys) context.reset(scope, key);
                setNotice(sectionReset.notice);
                setConfirmSection("");
              }}
            >
              {sectionReset.confirm}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
