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
| `appearance.accent` | `theme` | Highlight selections and primary workspace actions. |
| `appearance.density` | `compact` | Choose compact workspace rows or more room around tabs, settings, and sidebar items. |
| `appearance.fontFamily` | `"DM Sans", "Segoe UI", sans-serif` | CSS font family for the workspace. Fonts must be installed on this computer. |
| `appearance.reduceMotion` | `false` | Disable animated transitions and smooth editor scrolling. Windows reduced-motion preferences are also respected. |
| `appearance.statusBar` | `true` | Show connection, source control, session count, and layout status at the bottom. |
| `appearance.statusBarHidden` | empty | Status bar items to hide, as ids separated by commas or spaces: `accounts`, `connection`, `source-control`, `reconnect`, `sessions`, `layout` and `activity`. Empty (the default) shows every item, exactly as before. Unknown ids are ignored; an empty box is not accepted, so use the row's reset button to show every item again. Applies only while `appearance.statusBar` is on. See Status bar items below. Display only; nothing is sent to the shell or the seat. |
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
| `terminal.copyOnSelect` | `false` | Copy terminal text to the system clipboard shortly after you finish selecting it. Never pastes or sends anything to the shell. |
| `terminal.copyTrimTrailingWhitespace` | `false` | Remove the spaces and tabs at the end of each line of terminal text you copy, so pasted text carries no invisible trailing blanks. It applies to every way of copying terminal text: the Copy and Copy output buttons, the keyboard and right-click copy, Copy in the macOS Edit menu and Copy on select. Line breaks, leading spaces, blank lines and spaces inside a line are kept, and a selection of only spaces and tabs is copied as it is. `false` (the default) copies the text exactly as the terminal shows it; leave it off when trailing blanks matter, such as a Markdown hard line break. Applies at once to every open terminal. Changes only what is placed on the clipboard; nothing is sent to the shell or the seat, and Paste and Export are unchanged. |
| `terminal.confirmMultilinePaste` | `false` | Ask for confirmation, with the line count, before pasting text that contains a line break into a terminal. Nothing is sent until you confirm. |
| `terminal.showSizeOnResize` | `true` | Briefly show the terminal size as columns x rows after it is resized. Display only; nothing is sent to the shell or the seat. |
| `terminal.bellStyle` | `none` | What a terminal bell does inside HRig: `none` changes nothing, `visual` briefly highlights the terminal, at most once a second. No sound is played and nothing is sent to the shell or the seat. A desktop notification for a bell is the separate `notifications.terminalBell` setting; the two are independent and can both apply. |
| `terminal.minimumContrastRatio` | `1` | Lowest contrast ratio allowed between terminal text and its background, from 1 to 21 in steps of 0.5. `1` (the default) draws every color exactly as the program and theme set it; raise it (4.5 is the WCAG AA level, 7 is AAA) to lighten or darken only text that is too hard to read, such as dim ANSI colors. Backgrounds are never changed. Display only; nothing is sent to the shell or the seat. |
| `terminal.macOptionIsMeta` | `false` | macOS only; no effect on Windows or Linux. `false` (the default) keeps Option typing special characters such as accents. `true` makes Option act as the Meta key in terminals, so Option+B and Option+F move back and forward a word in shells such as zsh and bash, and Option no longer types special characters there. Applies at once to every open terminal. Changes only how your own key presses are encoded; nothing is sent to the shell or the seat unless you press a key. |
| `terminal.wordSeparator` | space, `()[]{}',"` and backtick | Characters that end a word when you double-click text in a terminal to select it; the default is xterm's own list, so nothing changes until you edit it. Up to 64 characters; line breaks and other control characters are not allowed, and the value cannot be empty (xterm treats empty text as its default, so empty never means no separators). Keep a space in the list unless you want a double-click to run across spaces. For example, a space, a double quote and a single quote make a double-click select `foo(bar)` or `a,b` whole. Applies at once to every open terminal. Changes only what a double-click selects; nothing is sent to the shell or the seat. |
| `workspace.refreshInterval` | `15` | Seconds between background rig and seat inventory refreshes on the active connection. |
| `connections.defaultKind` | `wsl` | Default type when creating a connection from a local workspace. |
| `connections.defaultRoot` | `~` | Default project directory for new WSL/SSH connections. Does not change existing connections. |
| `rig.defaultRuntime` | `codex` | Initial runtime when opening a new rig designer. OpenRig manages authentication and launch policy. |
| `rig.defaultTeamSize` | `2` | Initial recommendation size for new rig designs. Does not resize existing rigs. |
| `notifications.desktop` | `false` | Notify when a seat newly needs input or reports a failure. Windows notification preferences still apply. |
| `notifications.terminalBell` | `false` | Also notify when an unwatched terminal rings the bell (needs `notifications.desktop`). Seat/host name only, no terminal text. |
| `notifications.terminalQuiet` | `false` | Also notify when an unwatched terminal goes quiet after a burst of output (needs `notifications.desktop`). No terminal text. |
| `shortcuts.overrides` | empty | New keys for the three shortcuts that can be rebound, written as comma-separated `id=keys` pairs such as `workspace.reopenPanel=Ctrl+Shift+J`. Empty (the default) keeps every shortcut as it is. The Keyboard shortcuts sheet edits it and checks for clashes; see Shortcut overrides below. Changes only which keys you press; nothing is sent to the shell or the seat. |

Shortcut overrides: `shortcuts.overrides` keeps the saved key changes as one line of text, comma-separated `id=keys` pairs such as `workspace.reopenPanel=Ctrl+Shift+J,workspace.maximizePanel=Ctrl+Shift+Y`. It is one text setting because a setting holds a single value and the settings checks refuse braces, semicolons and angle brackets, so a JSON map cannot be stored. Press ? to open the Keyboard shortcuts sheet, search, choose Edit on a row that has the button, type the keys and choose Save; Reset puts one shortcut back and Reset all clears the setting. Only the three shortcuts listed in NAVIGATION.md under Shortcut overrides can be rebound, because their key handling already goes through one checked classifier; every other row in the sheet is fixed. Keys are written as Ctrl, Cmd or Mod (each means the main modifier of your computer, so one saved text works everywhere), Shift and one letter A to Z, for example Ctrl+Shift+Y. Shift is required and Alt is refused. Keys are refused when a terminal uses them (Shift with F, C, V or K), when the code editor uses them (Shift with A, G, I, K, L, O, R or Z), when a fixed shortcut uses them (for example Shift with P or T) or when another shortcut, moved or not, uses them. The old keys of a moved shortcut are released and go back to the terminal. An entry written here by hand that is refused or unknown is ignored, never an error, and the sheet lists it. Empty (the default) leaves every key and label exactly as before. The text is saved with the other preferences, in the user scope or, when the project already has its own value, in the project scope, and the Settings JSON export and import carry it like any other text setting; there is no separate keymap file. Changes only which key press runs a command; nothing is sent to the shell or the seat.

Terminal zoom: Ctrl/Cmd `+`, `-`, `0` and Ctrl+wheel change the font size of one terminal only (8-32 pt, remembered until the app restarts); `terminal.fontSize` stays the default for every terminal.

Status bar items: `appearance.statusBarHidden` lists the status bar items to hide, as ids separated by commas or spaces, for example `sessions, layout`. The ids are `accounts` (the Accounts button), `connection` (the Local workspace, WSL or SSH label), `source-control` (the Source control button), `reconnect` (the Reconnect all dropped button), `sessions` (the count of open sessions), `layout` (the Layout autosaved note) and `activity` (the Activity button). Ids are not case sensitive, a repeated id counts once, unknown ids are ignored and only the first 300 characters and 32 words are read. Empty text, the default, hides nothing, so the status bar is exactly what it was. The Reconnect all dropped button is drawn only while terminals are dropped and stays visible then unless `reconnect` is listed; hiding it does not remove the action, which stays in the command center as Terminal: Reconnect all dropped. A thin divider is drawn only between two shown items. The setting works in the user and the project scope, it is separate from `appearance.statusBar` (Show status bar), which still hides the whole bar and which focus mode still hides for the session, and a bar with every item hidden is an empty strip, so turn Show status bar off to remove the strip. The row is plain text (a setting holds one value and the settings checks refuse braces, semicolons and angle brackets, so a list or map cannot be stored), and the generic text rule applies: not empty, at most 300 characters. Display only; nothing is sent to the shell or the seat.

Terminal bell: `terminal.bellStyle` chooses only what a bell does inside HRig (`none` or `visual`). A third choice, a desktop notification, is deliberately not a value of this setting because it already exists as Terminal bell alerts (`notifications.terminalBell`, which needs `notifications.desktop`); the two settings are independent and can both apply.

Host label and tint: there is no settings row for it. A label and color belong to one connection, not to a preference, so they are not in the table above, not in the user or project scopes and not in the Settings JSON export or import. Run Set host label and tint in the command center to give a connection a short label and a palette color; they are saved under `hostTints` in workspace.json, keyed by connection ID, and a connection without one is not marked at all. See TERMINALS.md for what the terminal header shows.

## Follow-up ideas

Future candidates: custom VS Code/terminal theme imports, named profiles, remappable shortcuts for the fixed keys, per-language editor settings, settings-file synchronization, and signed automatic updates. These are not exposed as working controls in this release. Agent credentials, provider models, permissions, extension installation, and OpenRig policies stay under the owning harness rather than being silently changed by desktop preferences.

## Community themes (0.7.1)

Choose Catppuccin Mocha, Macchiato, Frappe or Latte, Nord, Dracula, Tokyo Night, or Gruvbox Dark under Appearance. HRig now has 13 palettes plus Follow Windows. Native syntax colors and all 16 ANSI terminal colors are included. Secondary UI text is adapted for readability while core colors retain the upstream palette. **Theme default** uses each theme's native accent; explicit mint, blue, violet, and amber overrides remain available and existing choices are retained.

Terminals can follow the app or use any bundled palette independently. Community themes work with user/project scopes, JSON transfers, detached windows, and live session-preserving changes. Themes are bundled data, with no runtime downloads or third-party extension execution. See [THEME_CREDITS.md](THEME_CREDITS.md) for pinned sources and bundled licenses.
