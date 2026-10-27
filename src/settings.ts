import { themes } from "./theme-catalog";
import { isWindows } from "./platform";
export const defaults = {
  "appearance.theme": "hrig-dark",
  "appearance.accent": "theme",
  "appearance.density": "compact",
  "appearance.fontFamily": '"DM Sans", "Segoe UI", sans-serif',
  "appearance.reduceMotion": false,
  "appearance.statusBar": true,
  "editor.fontSize": 13,
  "editor.fontFamily": '"Cascadia Code", Consolas, monospace',
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.wordWrap": "on",
  "editor.minimap": false,
  "editor.lineNumbers": "on",
  "editor.fontLigatures": false,
  "editor.renderWhitespace": "selection",
  "editor.bracketPairs": true,
  "editor.diffSideBySide": true,
  "editor.autoReload": true,
  "terminal.fontSize": 13,
  "terminal.fontFamily":
    '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
  "terminal.lineHeight": 1.28,
  "terminal.cursorStyle": "bar",
  "terminal.cursorBlink": true,
  "terminal.scrollback": 10000,
  "terminal.theme": "inherit",
  "terminal.localShell": "system",
  "terminal.autoReconnect": true,
  "workspace.refreshInterval": 15,
  "connections.defaultKind": isWindows ? "wsl" : "ssh",
  "connections.defaultRoot": "~",
  "rig.defaultRuntime": "codex",
  "rig.defaultTeamSize": 2,
  "rig.claudePlanMonthlyUsd": 200,
  "rig.codexPlanMonthlyUsd": 100,
  "notifications.desktop": false,
};
export type Preferences = typeof defaults;
export type SettingKey = keyof Preferences;
export type Overrides = Partial<Preferences>;
export type SettingsScope = "user" | "project";
export type Category =
  | "Appearance"
  | "Editor"
  | "Terminal"
  | "Workspace"
  | "Connections & rigs"
  | "Notifications";
type Option = { value: string; label: string };
export type Setting = {
  key: SettingKey;
  category: Category;
  label: string;
  description: string;
  options?: Option[];
  min?: number;
  max?: number;
  step?: number;
};
const options = (...values: string[]): Option[] =>
  values.map((value) => ({ value, label: value }));
export const schema: Setting[] = [
  {
    key: "rig.claudePlanMonthlyUsd",
    category: "Connections & rigs",
    label: "Claude plan budget (USD/month)",
    description:
      "Operator-declared plan budget for runtime prioritization, not detected quota. Set 0 for unknown. Change per project when accounts differ.",
    min: 0,
    max: 10000,
    step: 1,
  },
  {
    key: "rig.codexPlanMonthlyUsd",
    category: "Connections & rigs",
    label: "Codex plan budget (USD/month)",
    description:
      "Operator-declared plan budget for runtime prioritization, not detected quota. Set 0 for unknown. Change per project when accounts differ.",
    min: 0,
    max: 10000,
    step: 1,
  },
  {
    key: "appearance.theme",
    category: "Appearance",
    label: "Color theme",
    description:
      "Apply a coordinated theme to the workspace, editor, terminals, dialogs, and detached windows.",
    options: [
      ...Object.entries(themes).map(([value, theme]) => ({
        value,
        label: theme.name,
      })),
      { value: "system", label: "Follow Windows" },
    ],
  },
  {
    key: "appearance.accent",
    category: "Appearance",
    label: "Accent color",
    description: "Highlight selections and primary workspace actions.",
    options: [
      { value: "theme", label: "Theme default" },
      ...options("mint", "blue", "violet", "amber"),
    ],
  },
  {
    key: "appearance.density",
    category: "Appearance",
    label: "Interface density",
    description:
      "Choose compact workspace rows or more room around tabs, settings, and sidebar items.",
    options: options("compact", "comfortable"),
  },
  {
    key: "appearance.fontFamily",
    category: "Appearance",
    label: "Interface font",
    description:
      "CSS font family for the workspace. Fonts must be installed on this computer.",
  },
  {
    key: "appearance.reduceMotion",
    category: "Appearance",
    label: "Reduce motion",
    description:
      "Disable animated transitions and smooth editor scrolling. Windows reduced-motion preferences are also respected.",
  },
  {
    key: "appearance.statusBar",
    category: "Appearance",
    label: "Show status bar",
    description:
      "Show connection, source control, session count, and layout status at the bottom.",
  },
  {
    key: "editor.fontSize",
    category: "Editor",
    label: "Editor font size",
    description: "Text size in code editors and diffs, in pixels.",
    min: 10,
    max: 32,
  },
  {
    key: "editor.fontFamily",
    category: "Editor",
    label: "Editor font family",
    description: "Installed font family for code editors and diffs.",
  },
  {
    key: "editor.tabSize",
    category: "Editor",
    label: "Tab size",
    description:
      "Number of columns used for a tab. Overrides indentation detection.",
    min: 1,
    max: 8,
  },
  {
    key: "editor.insertSpaces",
    category: "Editor",
    label: "Insert spaces",
    description: "Insert spaces when pressing Tab instead of a tab character.",
  },
  {
    key: "editor.wordWrap",
    category: "Editor",
    label: "Word wrap",
    description: "Wrap long lines to the available editor width.",
    options: options("on", "off"),
  },
  {
    key: "editor.minimap",
    category: "Editor",
    label: "Show minimap",
    description: "Show a compact document overview beside the code.",
  },
  {
    key: "editor.lineNumbers",
    category: "Editor",
    label: "Line numbers",
    description: "Display absolute, relative, or no line numbers.",
    options: options("on", "relative", "off"),
  },
  {
    key: "editor.fontLigatures",
    category: "Editor",
    label: "Font ligatures",
    description:
      "Combine supported character sequences when using a compatible font.",
  },
  {
    key: "editor.renderWhitespace",
    category: "Editor",
    label: "Render whitespace",
    description:
      "Show spaces and tabs for the selected text, everywhere, or nowhere.",
    options: options("selection", "all", "none"),
  },
  {
    key: "editor.bracketPairs",
    category: "Editor",
    label: "Bracket pair colors",
    description: "Use matching colors for nested bracket pairs.",
  },
  {
    key: "editor.diffSideBySide",
    category: "Editor",
    label: "Side-by-side diffs",
    description:
      "Compare versions in two columns. Turn off for an inline diff.",
  },
  {
    key: "editor.autoReload",
    category: "Editor",
    label: "Reload clean files from disk",
    description:
      "Refresh an unmodified buffer when its file changes externally. Unsaved edits always remain protected.",
  },
  {
    key: "terminal.fontSize",
    category: "Terminal",
    label: "Terminal font size",
    description:
      "Live terminal text size in pixels; existing PTY sessions stay attached.",
    min: 10,
    max: 32,
  },
  {
    key: "terminal.fontFamily",
    category: "Terminal",
    label: "Terminal font family",
    description: "Installed monospace font family for terminal panels.",
  },
  {
    key: "terminal.lineHeight",
    category: "Terminal",
    label: "Terminal line height",
    description: "Spacing between terminal lines as a multiplier.",
    min: 1,
    max: 2,
    step: 0.05,
  },
  {
    key: "terminal.cursorStyle",
    category: "Terminal",
    label: "Cursor style",
    description: "Shape of the terminal cursor.",
    options: options("bar", "block", "underline"),
  },
  {
    key: "terminal.cursorBlink",
    category: "Terminal",
    label: "Blinking cursor",
    description: "Animate the terminal cursor when the terminal has focus.",
  },
  {
    key: "terminal.scrollback",
    category: "Terminal",
    label: "Scrollback lines",
    description:
      "Lines retained by each terminal view. Lowering this may discard old visible scrollback; the rig session continues.",
    min: 1000,
    max: 100000,
    step: 1000,
  },
  {
    key: "terminal.theme",
    category: "Terminal",
    label: "Terminal color theme",
    description:
      "Follow the application theme or keep terminals explicitly dark or light.",
    options: [
      { value: "inherit", label: "Follow application" },
      { value: "dark", label: "HRig Dark (legacy)" },
      ...Object.entries(themes).map(([value, theme]) => ({
        value,
        label: theme.name,
      })),
    ],
  },
  {
    key: "terminal.localShell",
    category: "Terminal",
    label: "New local shell",
    description:
      "Shell for new local terminals. System uses PowerShell on Windows and your login shell on macOS/Linux. Windows-only choices fall back to the login shell on Unix.",
    options: [
      { value: "system", label: "System default" },
      { value: "powershell", label: "Windows PowerShell" },
      { value: "cmd", label: "Command Prompt" },
      { value: "bash", label: "Bash (macOS/Linux)" },
      { value: "zsh", label: "Zsh (macOS/Linux)" },
    ],
  },
  {
    key: "terminal.autoReconnect",
    category: "Terminal",
    label: "Automatic seat reconnection",
    description:
      "Retry failed existing seat attachments with bounded backoff, up to six attempts. Never starts another agent.",
  },
  {
    key: "workspace.refreshInterval",
    category: "Workspace",
    label: "Rig refresh interval",
    description:
      "Seconds between background rig and seat inventory refreshes on the active connection.",
    min: 5,
    max: 120,
  },
  {
    key: "connections.defaultKind",
    category: "Connections & rigs",
    label: "New connection type",
    description:
      "Default type when creating a connection from a local workspace.",
    options: [
      { value: "wsl", label: "WSL" },
      { value: "ssh", label: "SSH" },
    ],
  },
  {
    key: "connections.defaultRoot",
    category: "Connections & rigs",
    label: "New connection project root",
    description:
      "Default project directory for new WSL/SSH connections. Does not change existing connections.",
  },
  {
    key: "rig.defaultRuntime",
    category: "Connections & rigs",
    label: "Designer default runtime",
    description:
      "Initial runtime when opening a new rig designer. OpenRig manages authentication and launch policy.",
    options: [
      { value: "codex", label: "Codex" },
      { value: "claude-code", label: "Claude Code" },
    ],
  },
  {
    key: "rig.defaultTeamSize",
    category: "Connections & rigs",
    label: "Designer default team size",
    description:
      "Initial recommendation size for new rig designs. Does not resize existing rigs.",
    options: [
      { value: "1", label: "Solo" },
      { value: "2", label: "Pair" },
      { value: "4", label: "Team" },
    ],
  },
  {
    key: "notifications.desktop",
    category: "Notifications",
    label: "Desktop attention notifications",
    description:
      "Notify when a seat newly needs input or reports a failure. Windows notification preferences still apply.",
  },
];
export function validateOverrides(value: unknown): Overrides {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Settings must be a JSON object.");
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const row = schema.find((s) => s.key === key);
    if (!row) throw new Error("Unknown setting: " + key);
    const fallback = defaults[row.key];
    if (typeof v !== typeof fallback)
      throw new Error("Wrong value type for " + key);
    if (
      typeof v === "number" &&
      (!Number.isFinite(v) ||
        v < (row.min ?? -Infinity) ||
        v > (row.max ?? Infinity) ||
        (key !== "terminal.lineHeight" && !Number.isInteger(v)))
    )
      throw new Error("Value out of range for " + key);
    if (row.options && !row.options.some((o) => o.value === String(v)))
      throw new Error("Unsupported option for " + key);
    if (
      typeof v === "string" &&
      (!v.trim() || v.length > 300 || /[\u0000-\u001f;{}<>]/.test(v))
    )
      throw new Error("Invalid text for " + key);
    result[key] = v;
  }
  return result as Overrides;
}
export function safeOverrides(value: unknown): Overrides {
  try {
    return validateOverrides(value ?? {});
  } catch {
    return {};
  }
}
export function projectKey(connectionId: string, root: string) {
  return connectionId + "::" + root;
}
export function resolveSettings(
  user: Overrides = {},
  project: Overrides = {},
): Preferences {
  return { ...defaults, ...user, ...project };
}
