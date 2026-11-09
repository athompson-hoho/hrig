# HRig settings

Open the gear in the activity rail, press **Ctrl+,**, choose **Settings** from Tools, or use **Open settings** in the command center. Settings is a dockable page, and can be maximized or detached like other panels.

## Design and feature plan

The design follows [VS Code's user/workspace settings](https://code.visualstudio.com/docs/configure/settings) and [theme picker](https://code.visualstudio.com/docs/configure/themes), plus [Orca's grouped settings reference](https://www.onorca.dev/docs/settings). The controls use HRig's compact tool-panel styling.

| Idea | Delivered behavior |
| --- | --- |
| Searchable preferences | Search setting names, descriptions, keys, and categories; filter to modified values. |
| User and project scope | Local project overrides keyed by connection and project folder; reset rows to inherit. |
| Coordinated themes | HRig Dark, Graphite, Midnight, Daylight, High Contrast, and Follow Windows across app, editor, terminal and detached panels. |
| Appearance controls | Four accent colors, installed UI fonts, density, status-bar visibility, reduced motion. |
| Editor preferences | Live font, indentation, whitespace, wrap, minimap, line-number and ligature options. |
| Diff and disk behavior | Inline/side-by-side diffs; optional clean-buffer reload; unsaved-buffer protection stays enabled. |
| Terminal preferences | Live font, line spacing, cursor, scrollback, independent color theme; local PowerShell or Command Prompt for new shells. |
| Workspace and rig defaults | Inventory refresh frequency, connection defaults, rig designer runtime and team size. |
| Notifications | Default-off desktop needs-input notifications, preserving earlier explicit opt-in; separate optional terminal alerts. |
| Transfer and discoverability | Validated preferences-only JSON import/export, per-row and scoped resets, shortcut reference and About. |

## Scope and persistence

User preferences apply globally. Project preferences override them for the active connection/folder. They are stored locally in HRig's workspace.json, not in the project's source files, .vscode settings, or the remote host. The current project's effective appearance applies to the workspace and all its panels. Existing layouts, connections, unsaved buffers, and agent sessions are retained when changing preferences.

Settings are saved automatically through the existing atomic workspace persistence. Numeric and font inputs commit on blur or Enter; toggles and selections apply immediately. Resetting a project row removes its override and restores the user value. Resetting a user row restores the default. Reset scope asks for confirmation.

Seat sort order (`rig.seatSort`) also controls the sidebar's Sort sessions selection. An existing project override wins, including an explicit `name` overriding a user `activity` value. Changing the sidebar selection updates that project override when the project owns the key; otherwise it updates the user preference. Reset the project row to inherit the user order, or reset the user row to restore Name. The enum uses the same automatic workspace.json save/load lifecycle and validated imports as other preferences. Sorting preserves the current search/status filters and never opens, sends input to or relaunches a seat.

Changing terminal appearance updates the existing xterm view, without replacing its PTY. Selecting a different local shell affects newly created local terminals; remote sessions continue to use their existing harness. Reconnection remains bounded to six attempts and never launches agents. Decreasing scrollback can remove older visible history.

The Settings JSON view exports preferences only, including any configured default-root preference; it excludes saved connections, credentials, current project bindings, layouts and terminal output. Imports replace only the selected scope after full key/type/range validation. Before anything is applied, the JSON view checks the text and shows what would be added, changed, removed (the import replaces the selected scope) and skipped. Malformed JSON, an unreadable version, oversized files or a missing settings object block Apply. Individual unknown keys (for example from a newer or older HRig) and invalid values are skipped and listed, and the remaining valid settings can still be applied.

**Migration notes.** The file format is `{ "version": 1, "settings": { ... } }`. A file with a higher version is read as version 1 and flagged. Settings are never renamed silently: a key HRig does not know is skipped, so removed or renamed settings fall back to their defaults. Exporting always writes the current version.

## Settings catalog

| Key | Default | Behavior |
| --- | --- | --- |
| `appearance.theme` | `hrig-dark` | Apply a coordinated theme to the workspace, editor, terminals, dialogs, and detached windows. |
| `appearance.accent` | `theme` | Highlight selections and primary workspace actions. |
| `appearance.density` | `compact` | Choose compact workspace rows or more room around tabs, settings, and sidebar items. |
| `appearance.fontFamily` | `"DM Sans", "Segoe UI", sans-serif` | CSS font family for the workspace. Fonts must be installed on this computer. |
| `appearance.reduceMotion` | `false` | Disable animated transitions and smooth editor scrolling. Windows reduced-motion preferences are also respected. |
| `appearance.statusBar` | `true` | Show connection, source control, session count, and layout status at the bottom. |
| `editor.fontSize` | `13` | Text size in code editors and diffs, in pixels. |
| `editor.fontFamily` | `"Cascadia Code", Consolas, monospace` | Installed font family for code editors and diffs. |
| `editor.tabSize` | `2` | Number of columns used for a tab. Overrides indentation detection. |
| `editor.insertSpaces` | `true` | Insert spaces when pressing Tab instead of a tab character. |
| `editor.wordWrap` | `on` | Wrap long lines to the available editor width. |
| `editor.minimap` | `false` | Show a compact document overview beside the code. |
| `editor.lineNumbers` | `on` | Display absolute, relative, or no line numbers. |
| `editor.fontLigatures` | `false` | Combine supported character sequences when using a compatible font. |
| `editor.renderWhitespace` | `selection` | Show spaces and tabs for the selected text, everywhere, or nowhere. |
| `editor.bracketPairs` | `true` | Use matching colors for nested bracket pairs. |
| `editor.breadcrumbs` | `false` | Show the open file path as folder breadcrumbs (the last 8 folders and the file) in the editor toolbar. Display only; crumbs do not navigate. |
| `editor.largeFileWarnKb` | `1024` | Warn when opening an editable file of at least this many KB (100 to 2000). Files over 2 MB and binary files open as a read-only preview (image, hex dump, or the beginning of a large text file) and are never edited or saved. |
| `editor.diffSideBySide` | `true` | Compare versions in two columns. Turn off for an inline diff. The diff panel toolbar has an Inline / Side by side button that changes this setting (the project override when the project sets one, otherwise your user setting), so the choice persists across restarts. |
| `editor.autoReload` | `true` | Refresh an unmodified buffer when its file changes externally. Unsaved edits always remain protected. |
| `terminal.fontSize` | `13` | Live terminal text size in pixels; existing PTY sessions stay attached. |
| `terminal.fontFamily` | `"Cascadia Code", "Cascadia Mono", Consolas, monospace` | Installed monospace font family for terminal panels. |
| `terminal.lineHeight` | `1.28` | Spacing between terminal lines as a multiplier. |
| `terminal.cursorStyle` | `bar` | Shape of the terminal cursor. |
| `terminal.cursorBlink` | `true` | Animate the terminal cursor when the terminal has focus. |
| `terminal.scrollbackBudget` | `200000` | Total scrollback lines shared by all open terminals (0 = no limit). With the default 10,000 lines per terminal the budget only matters beyond 20 terminals; each terminal keeps at least 1,000 lines, so extreme counts can exceed it. Only the on-screen history is trimmed; sessions keep running. |
| `terminal.scrollback` | `10000` | Lines retained by each terminal view. Lowering this may discard old visible scrollback; the rig session continues. |
| `terminal.theme` | `inherit` | Follow the application theme or keep terminals explicitly dark or light. |
| `terminal.localShell` | `powershell` | Shell for new Windows terminals. Existing terminals and remote agent sessions are unaffected. |
| `terminal.autoReconnect` | `true` | Retry failed existing seat attachments with bounded backoff, up to six attempts. Never starts another agent. |
| `workspace.refreshInterval` | `15` | Seconds between background rig and seat inventory refreshes on the active connection. |
| `workspace.updateCheckHours` | `6` | How often installed HRig builds check for a new version in the background: `6`, `12`, `24` (daily), `168` (weekly) hours, or `0` for never automatically. Checks never download or install anything on their own; Check for updates still works on demand. A `0` value skips the check shortly after launch once settings load; unpackaged development builds never check. |
| `connections.defaultKind` | `wsl` | Default type when creating a connection from a local workspace. |
| `connections.defaultRoot` | `~` | Default project directory for new WSL/SSH connections. Does not change existing connections. |
| `rig.defaultRuntime` | `codex` | Initial runtime when opening a new rig designer. OpenRig manages authentication and launch policy. |
| `rig.defaultTeamSize` | `2` | Initial recommendation size for new rig designs. Does not resize existing rigs. |
| `rig.seatClick` | `open` | What clicking a sidebar session does: `open` (open its terminal, the default) or `select` (highlight the row only; an explicit Open terminal button on the row opens it). Selecting never opens, sends input to, or relaunches a session. Unsupported imported values are rejected. |
| `rig.cacheInventory` | `false` | Opt in (user level only; a project override has no effect) to storing the last verified session list (rig names, session names and ids, pods, runtimes, models, status and activity text, work counts and last-activity time; no error text) in a separate file in the app data folder (private to your account on macOS/Linux; inherits your user-profile permissions on Windows), so the sidebar shows it immediately after a restart. It is shown as the last known snapshot with its original age, and seat actions stay disabled until a live check succeeds. Entries older than 7 days are ignored. Turning it off deletes the file. |
| `rig.seatSort` | `name` | Seat sort order: `name` (Name), `activity` (Activity (working first)), or `attention-first` (Attention first). Activity uses current normalized status priority, not timestamps or recency; see [navigation](NAVIGATION.md). Unsupported imported values are rejected. |
| `notifications.desktop` | `false` | Opt in to seat-name-only notifications for later observed needs-input transitions in verified inventory on the current connection. Enabling starts silently; failures do not notify. Desktop support and OS settings may prevent display. |
| `notifications.terminalBell` | `false` | Also notify when an unwatched terminal rings the bell (needs `notifications.desktop`). Seat/host name only, no terminal text. |
| `notifications.terminalQuiet` | `false` | Also notify when an unwatched terminal goes quiet after a burst of output (needs `notifications.desktop`). No terminal text. |

### Desktop needs-input notifications

Use Desktop needs-input notifications in Settings → Notifications, or Desktop notifications when a seat newly needs input in Attention center. Both use the effective `notifications.desktop` preference: a project override wins over the user value. The Attention checkbox updates the project override when that key already exists there; otherwise it updates the user value. Turning it off is reversible. Reset a project row to inherit the user value; reset the user row to restore the default `false`. When migrating a workspace without newer preferences, an earlier explicit desktop-notification opt-in is retained.

Enabling, re-enabling, changing the connection owner (including repointing the same saved connection), or recovering from unavailable inventory starts with a silent healthy baseline. Existing needs-input seats are not announced. Only a later observed transition into normalized `attention` can request a notification, deduplicated by seat identity within that owner. Repeated snapshots or name/activity/error changes while the seat stays in attention do not repeat it. A later observed departure and re-entry can notify again. Failed seats and reported errors are not needs-input events.

Disabled, missing, unverified, foreign or stale/unhealthy inventory cannot emit. Both explicit errors and quiet poll failures disarm the baseline; the next healthy current-owner snapshot silently seeds it again. A seat entering needs-input during failure or at that recovery snapshot may therefore go unannounced. There is no queued catch-up or delivery retry. This uses the existing inventory refresh cadence on the current connection; hidden-window inventory polling is suppressed. It adds no polling and promises no continuous background or fleet monitoring. See [navigation scope](NAVIGATION.md#desktop-needs-input-notifications).

HRig requests a silent notification with only the exact accepted seat name as its title, without a body or generated suffix. Invalid names or extra payload fields/arguments are refused. OS support, permissions, app identity, title truncation and delivery suppression can affect presentation; checked/On records a preference, not permission or confirmed delivery. See [notification privacy](PRIVACY.md#desktop-notifications).

Terminal bell and quiet alerts remain separate opt-ins, each defaulting to `false` and also requiring `notifications.desktop`. They retain the existing generic notification route and seat/shell-label and host metadata, without terminal text. The seat-name-only boundary above applies to needs-input seat alerts, not these terminal alerts.

Actual OS permission/display, keyboard and assistive-technology behavior, narrow/short layouts, themes/density and persistence across a real restart remain unobserved; source and inert tests do not establish those outcomes.

Terminal zoom: Ctrl/Cmd `+`, `-`, `0` and Ctrl+wheel change the font size of one terminal only (8-32 pt, remembered until the app restarts); `terminal.fontSize` stays the default for every terminal.

## Follow-up ideas

Future candidates: custom VS Code/terminal theme imports, named profiles, remappable shortcuts, per-language editor settings, settings-file synchronization, and signed automatic updates. These are not exposed as working controls in this release. Agent credentials, provider models, permissions, extension installation, and OpenRig policies stay under the owning harness rather than being silently changed by desktop preferences.

## Community themes (0.7.1)

Choose Catppuccin Mocha, Macchiato, Frappe or Latte, Nord, Dracula, Tokyo Night, or Gruvbox Dark under Appearance. HRig now has 13 palettes plus Follow Windows. Native syntax colors and all 16 ANSI terminal colors are included. Secondary UI text is adapted for readability while core colors retain the upstream palette. **Theme default** uses each theme's native accent; explicit mint, blue, violet, and amber overrides remain available and existing choices are retained.

Terminals can follow the app or use any bundled palette independently. Community themes work with user/project scopes, JSON transfers, detached windows, and live session-preserving changes. Themes are bundled data, with no runtime downloads or third-party extension execution. See [THEME_CREDITS.md](THEME_CREDITS.md) for pinned sources and bundled licenses.
