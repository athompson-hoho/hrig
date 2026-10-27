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
| Notifications | Desktop attention notification preference, migrated from the older attention panel option. |
| Transfer and discoverability | Validated preferences-only JSON import/export, per-row and scoped resets, shortcut reference and About. |

## Scope and persistence

User preferences apply globally. Project preferences override them for the active connection/folder. They are stored locally in HRig's workspace.json, not in the project's source files, .vscode settings, or the remote host. The current project's effective appearance applies to the workspace and all its panels. Existing layouts, connections, unsaved buffers, and agent sessions are retained when changing preferences.

Settings are saved automatically through the existing atomic workspace persistence. Numeric and font inputs commit on blur or Enter; toggles and selections apply immediately. Resetting a project row removes its override and restores the user value. Resetting a user row restores the default. Reset scope asks for confirmation.

Changing terminal appearance updates the existing xterm view, without replacing its PTY. Selecting a different local shell affects newly created local terminals; remote sessions continue to use their existing harness. Reconnection remains bounded to six attempts and never launches agents. Decreasing scrollback can remove older visible history.

The Settings JSON view exports preferences only, including any configured default-root preference; it excludes saved connections, credentials, current project bindings, layouts and terminal output. Imports replace only the selected scope after full key/type/range validation. Unknown keys, invalid values, oversized files and malformed JSON are rejected before any preference is applied.

## Settings catalog

| Key | Default | Behavior |
| --- | --- | --- |
| `appearance.theme` | `hrig-dark` | Apply a coordinated theme to the workspace, editor, terminals, dialogs, and detached windows. |
| `appearance.accent` | `mint` | Highlight selections and primary workspace actions. |
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
| `editor.diffSideBySide` | `true` | Compare versions in two columns. Turn off for an inline diff. |
| `editor.autoReload` | `true` | Refresh an unmodified buffer when its file changes externally. Unsaved edits always remain protected. |
| `terminal.fontSize` | `13` | Live terminal text size in pixels; existing PTY sessions stay attached. |
| `terminal.fontFamily` | `"Cascadia Code", "Cascadia Mono", Consolas, monospace` | Installed monospace font family for terminal panels. |
| `terminal.lineHeight` | `1.28` | Spacing between terminal lines as a multiplier. |
| `terminal.cursorStyle` | `bar` | Shape of the terminal cursor. |
| `terminal.cursorBlink` | `true` | Animate the terminal cursor when the terminal has focus. |
| `terminal.scrollback` | `10000` | Lines retained by each terminal view. Lowering this may discard old visible scrollback; the rig session continues. |
| `terminal.theme` | `inherit` | Follow the application theme or keep terminals explicitly dark or light. |
| `terminal.localShell` | `powershell` | Shell for new Windows terminals. Existing terminals and remote agent sessions are unaffected. |
| `terminal.autoReconnect` | `true` | Retry failed existing seat attachments with bounded backoff, up to six attempts. Never starts another agent. |
| `workspace.refreshInterval` | `15` | Seconds between background rig and seat inventory refreshes on the active connection. |
| `connections.defaultKind` | `wsl` | Default type when creating a connection from a local workspace. |
| `connections.defaultRoot` | `~` | Default project directory for new WSL/SSH connections. Does not change existing connections. |
| `rig.defaultRuntime` | `codex` | Initial runtime when opening a new rig designer. OpenRig manages authentication and launch policy. |
| `rig.defaultTeamSize` | `2` | Initial recommendation size for new rig designs. Does not resize existing rigs. |
| `notifications.desktop` | `false` | Notify when a seat newly needs input or reports a failure. Windows notification preferences still apply. |

## Follow-up ideas

Future candidates: custom VS Code/terminal theme imports, named profiles, remappable shortcuts, per-language editor settings, settings-file synchronization, and signed automatic updates. These are not exposed as working controls in this release. Agent credentials, provider models, permissions, extension installation, and OpenRig policies stay under the owning harness rather than being silently changed by desktop preferences.
