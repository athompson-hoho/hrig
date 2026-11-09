# Jumping to the previous or next prompt in a terminal

Design note only; not implemented. HRig has no previous-prompt or next-prompt navigation, and this note changes no code, adds no setting and has no test.

## Goal

Press a key in a terminal to scroll to the previous or next shell prompt, so a long output can be skipped command by command.

## Current behavior

- HRig sees a terminal's output as text and cannot tell where a prompt, a command or its output begins. Shells, WSL distributions, SSH hosts and seat sessions run whatever shell and prompt the person configured.
- What exists is manual or heuristic. Mark view (`src/TerminalSessionTools.tsx`) puts an xterm marker (`registerMarker`) on the top visible line of the normal buffer, up to 100 marks, and a mark list jumps back with `scrollToLine`. Marks are not saved, and xterm drops a marker when its line leaves the buffer (`src/terminal-scrollback.ts`). Previous error and Next error (`errorLine` in `src/terminal-navigation.ts`) search retained rows for error, failed, fatal, exception or a Traceback line; TERMINALS.md calls this a text heuristic, not a command-status detector.
- No code uses xterm's OSC handlers today. The installed `@xterm/xterm` is 6.0.0; its typings expose `term.parser.registerOscHandler(ident, callback)`, `registerMarker` and `registerDecoration`. Whether xterm.js itself does anything with OSC 133 was not checked.
- Which keys reach a terminal is decided by `classifyTerminalKey` in `src/terminal-keys.ts`, used by the key handler in `src/TerminalTools.tsx`: find, paste, copy and clear are taken by HRig and everything else returns "pass" and goes to xterm and the shell. The shortcut sheet is generated from the catalog in `src/shortcuts.ts`, and `docs/shortcut-rebinding.md` describes how key handling is split between the app handler and the terminal classifier.

## Why it needs the shell

A reliable answer to "where is the prompt" has to come from the shell. The convention is semantic prompt marks: the shell prints OSC 133 sequences around the prompt (A at the start of a prompt, B where the command starts, C where its output starts, D when it finishes, with an exit status), and VS Code uses its own OSC 633 variant. This is from the public terminal conventions and was not checked against any shell in this repository. Without those marks the only route is guessing from the text.

## Risks

- Injecting an integration script into the person's shell startup runs code in their shell, which breaks the rule that nothing is run for them. Out of scope without approval.
- A heuristic on the prompt line (a regex for `$`, `#`, `>` or a path) gives false positives in program output and breaks with every custom prompt, multi-line prompt, right-side prompt and shell.
- Marks are untrusted. Any program can print OSC 133, so a mark only says "something printed this here", never that a command ran or succeeded. Marks must drive scrolling and nothing else: not logging, not sending, not exit-status claims. A hostile or buggy stream could print many; the count of kept marks must be capped and the OSC payload read as at most its first few characters (xterm.js limits an OSC payload to 10 MB, per its typings).
- Terminals reflow, clear and trim: markers vanish with trimmed or cleared lines, and a window resize reflows lines. The alternate screen (editors, pagers, full-screen programs) has no prompts; marks there would be wrong, as Mark view already refuses outside the normal buffer.
- Seats: a seat terminal attaches to tmux, which draws its own screen and keeps its own scrollback with its own copy mode. Whether marks printed inside tmux reach HRig, and what they would point at, must be tested (tmux may need passthrough configured); it was not tested here.
- Key conflicts. Ctrl+Up and Ctrl+Down (and Cmd+Up and Cmd+Down on macOS) already reach the shell or a program as escape sequences, and some shells and programs bind them. Taking them changes what a key does inside a terminal. Other terminals use these or similar chords; that was not checked for this note.
- IME and non-US layouts: arrow-key chords are not the same on every layout and input method.
- Remote hosts and WSL emit marks only if configured there, so behavior would differ per host and the feature can look broken when it is simply unconfigured.

## Options, in order of preference

1. Read OSC 133 (A, B, C and D) when the person's shell already emits it, with `term.parser.registerOscHandler(133, ...)` and a marker per prompt start. No injection, nothing sent to the shell. It works only where the marks are printed (some prompt tools and shells can be set to; which ones, and how, was not verified here).
2. A user-initiated snippet that inserts, never runs, a documented prompt-hook line for the person to read, adapt and add to their own shell configuration. It reuses the reviewed insert channel (`sendTerminalCommand` in `src/terminal-commands.ts`, no Enter). It is per shell (bash, zsh, fish, PowerShell; Command Prompt was not examined), HRig cannot know which shell is running, and a wrong line is harmful, so this needs shell-specific text and a warning.
3. A regex on the prompt line. Rejected for the reasons above.
4. Manual marks, which exist (Mark view).

## Recommendation

Do nothing in this wave. If it is approved, build option 1 only:

- A setting such as `terminal.promptMarks`, default off, with the normal setting rules (a catalog entry, validation, SETTINGS.md and tests). No setting is added now, because a setting that does nothing would only mislead.
- With it on, each terminal registers the OSC 133 handler once per terminal (and again after a reconnect, which creates a new terminal view), keeps a capped number of markers, ignores marks on the alternate screen, and returns false from the handler so nothing else changes.
- Two commands, Previous prompt and Next prompt, in the command center, and one pair of shortcuts added through the catalog in `src/shortcuts.ts`, handled in `classifyTerminalKey`, listed in the shortcut sheet and in NAVIGATION.md. The chord must be chosen after checking which shells, programs and tmux setups lose a key, and it must act only while `terminal.promptMarks` is on, so with the setting off every key reaches the shell exactly as today.
- A visible hint, "No prompt marks seen in this terminal", when the key is pressed and none were received, so a shell that emits no marks is not mistaken for a broken feature. It names option 2 as the way to get marks, and does not insert anything by itself.
- Nothing is typed or sent to the shell or the seat by the navigation itself.

## Approval gate

A person must approve the setting and its default, the chosen key chord and what it takes from the shell, the hint wording, and whether the option 2 snippet is offered at all. Anything that touches the person's shell startup, even by inserting text, needs its own approval. Until then no code, setting or shortcut is added.

## Tests an implementation must add

- With `terminal.promptMarks` off, no OSC handler is registered, no marker is created and every key, including the chosen chord, reaches the shell as before (`tests/terminal-keys.test.cjs` style).
- With it on, A marks create markers and scrolling goes to the previous or next one; D and the exit status never change what is shown or sent; malformed, empty and oversized OSC 133 payloads are ignored.
- The marker count is capped, and markers that leave the buffer (trim, clear, reconnect) disappear from the list without errors.
- Marks on the alternate screen are ignored; navigation with no marks shows the hint and does not scroll.
- The shortcut appears in the catalog and the sheet, does not clash with another shortcut (`tests/shortcuts.test.cjs`), and with the setting off does not take the key.
- Navigation never writes to the PTY, never calls the log, export or send channels.
- A real-display check with bash, zsh, fish and PowerShell where configured to emit marks, a WSL shell, an SSH host, a seat terminal in tmux, a full-screen program, resizing, and each supported keyboard layout.
