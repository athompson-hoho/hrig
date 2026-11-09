# Terminal scrollback persistence

Design note only; not implemented. Nothing in HRig writes terminal output to disk unless you start a log yourself, and this note does not change that. The one code artifact that goes with it, `src/scrollback-snapshot.ts`, is a pure helper that nothing imports, and there is no setting.

## Goal

Keep the visible history of a plain shell terminal across an app restart: opt-in, bounded and plain text. Today a local or SSH shell that is closed or restarted starts with an empty terminal, and what it printed is gone.

## Current behavior

- The terminal view keeps `terminal.scrollback` lines (default 10,000, allowed 1,000 to 100,000, `src/settings.ts`). Older lines are dropped, and `watchScrollbackLoss` and `discardNotice` in `src/terminal-scrollback.ts` tell the person when that happens.
- Seat terminals attach with `tmux attach-session` (`sessionCommand` in `electron/core.cjs`), so history comes from the session, not from HRig. TERMINALS.md says the retained history is replayed on re-attach; how many lines tmux sends was not measured for this note. Only plain shells lose their output on restart.
- The main process keeps the last 300,000 characters of raw PTY output per terminal in memory (`item.buffer` in `electron/main.cjs`) and hands it back when a terminal is attached again. That survives a renderer reload, not an app restart, because the shell itself ends with the app. It is raw output, escape sequences included.
- `terminalText(term)` in `src/terminal-output.ts` returns the rendered buffer as plain text: no escape sequences, soft-wrapped rows joined, trailing blank rows dropped. It reads `term.buffer.active`, so while a full-screen program is running it returns the alternate screen (TERMINALS.md says so for export). A snapshot would have to read `term.buffer.normal` instead.
- Routes that exist today, both explicit: Start log (TERMINALS.md) appends future output to a file you choose, and Export in the terminal tools saves what is retained now through a native save dialog (`terminal:export` in `electron/terminal-tools.cjs`, 32 MiB limit). Neither is automatic and neither restores anything.
- The stance of the existing features is cautious. Logging is off by default, never restored from settings, per session and chosen through a native file chooser; its file is capped at 32 MiB with 1 MiB of queued writes (`electron/terminal-logging.cjs`). The output counter stores no text, and search and paste history are kept in memory only, because output holds secrets.

## Risks

- Secrets. Scrollback is whatever programs printed: tokens shown by `env`, passwords an application echoed, seat transcripts. A file on disk outlives the session, is copied by backups and sync tools, and is read by other programs running as the same user.
- Wrong file. `workspace.json` is written on every state save, is capped at 8 MiB in `electron/main.cjs` and is read by other code (the standalone mobile gateway reads its connections; what else reads it, for example a settings export, was not traced for this note). Terminal text must never go into it.
- Control characters on restore. Text written back with `term.write` is parsed as terminal input. A stored file that holds an escape sequence could change the title, write the clipboard, or make the terminal answer a query, and `onData` answers go to the shell (`src/TerminalPanel.tsx`). So restored text must be filtered to printable text and line breaks first, and must never be sent to the PTY. This follows xterm.js behavior as understood here; it was not tested.
- Confusion. Restored lines look like live output unless they are marked, and Export, Copy output and Find would include them.
- Cost and failure. A flush at quit adds time to shutdown (logs already get up to four seconds, TERMINALS.md), a crash writes nothing, and a half-written file must not be restored. Many terminals times large buffers is a disk and a privacy footprint that grows without anyone choosing it.
- Remote hosts. A snapshot of an SSH terminal puts that host's output on this computer.

## Options

1. Reuse Start log. Already built, per session, a file you chose. Not a restore: the person reads the file.
2. Reuse Export. One-off and manual. Same.
3. A private file per terminal under `app.getPath("userData")`, for example `scrollback/<terminalId>.txt`, mode 0600 (`electron/drafts.cjs` already writes its files with `mode: 0o600`), written by the main process, never inside `workspace.json`, not in any export and not reachable by the mobile gateway.
4. The same, encrypted with `safeStorage` (used for the Linear key in `electron/integrations.cjs`, which first checks that encryption is available and, on Linux, that the backend is not `basic_text`). Where encryption is unavailable, the feature would refuse rather than fall back to plain text.
5. Keep the in-memory buffer from the main process across a renderer reload only (today's behavior) and do nothing for restart.

## Recommendation

Ship this note and nothing else now; people who want history today use Start log and Export, and TERMINALS.md says so. If it is approved later, build option 3 with option 4 as the minimum bar, with these rules:

- Opt-in per terminal, not global. A setting such as `terminal.persistScrollback`, default off and held at the user level so a project's settings cannot turn it on, plus a per-terminal switch. A warning that scrollback can contain secrets is shown when it is enabled, and no redaction is promised (pattern-based redaction would be best effort and is not part of this).
- Plain shells only. Seat terminals are left out because their session already holds the history.
- Content: `terminalText` of the normal buffer, with the alternate screen excluded.
- Caps: at most the terminal's `terminal.scrollback` lines and never more than 5,000 saved, 1 MiB per terminal, 20 MiB in total with the oldest evicted, and a limit on the number of terminals. The cap rule is written down and tested in `boundSnapshot(text, { maxLines, maxBytes })` in `src/scrollback-snapshot.ts`: it keeps the newest whole lines within both caps, cuts a single over-long line only on a character boundary and never inside a UTF-8 sequence or a CRLF, reports `truncated`, treats a cap that is not a positive number as "keep nothing", and never throws.
- Restore: written once, before the new session starts, as a banner such as "Restored output from <time>, not live", filtered to printable text, never sent to the shell, never run.
- Removal: delete on terminal close, when the setting is turned off and from a "Clear saved scrollback" button. Write to a temporary file and rename, so a crash leaves the old file or none.

## Approval gate

A person must approve the storage and consent design before any of this is built: where the text lives, that it is encrypted or why not, the opt-in and warning wording, the caps and the restore banner. Until then no terminal output is written to disk by HRig, there is no setting, and `boundSnapshot` stays unused.

## Tests an implementation must add

- `boundSnapshot` keeps passing its own tests (`tests/scrollback-snapshot.test.cjs`), including the test that no application file imports it until the feature is approved and wired.
- With the setting off, nothing is written: no file, no directory, no timer, no IPC call.
- A file is created only after the per-terminal opt-in, has mode 0600, lives under `userData` and not in `workspace.json`, and is absent from settings and workspace exports.
- A saved file never exceeds the line, byte, total and terminal-count caps, and eviction removes the oldest first.
- Alternate-screen content and seat terminals are never saved.
- Restore filters every control character, including ESC, OSC and CSI sequences and a stored query such as a device-attribute request, writes nothing to the PTY and shows the "not live" banner.
- Deletion on terminal close, on turning the setting off and from the clear button; a crash mid-write leaves no partial file that is restored.
- Encryption unavailable means refuse, not plain text.
- A real-display check of the warning, the banner, Find and Export with restored text, and quit time with many large terminals.
