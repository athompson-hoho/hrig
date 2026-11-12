# Idle CPU audit (X13)

Question: when HRig is open but the user is not doing anything (or the window is hidden or
minimized), what wakes the app up? Method: read-only search of every `setInterval` /
repeating `setTimeout` in `src/` and `electron/`, then reading each call site. No profiler was
run (no display on the build host), so costs below are from the code, not a measurement.

## Renderer timers

| Where | Period | While window hidden (before) | Now | Notes |
| --- | --- | --- | --- | --- |
| Inventory poll (`App.tsx`) | `workspace.refreshInterval` (15 s default), backoff on failure | paused (already checked `document.hidden`), refreshes on show | same | Calls the OpenRig CLI on the host: the most expensive timer. |
| Task board (`TaskBoard.tsx`) | 15 s | **kept polling** | paused, one catch-up on show | One `rig queue` call per tick while the panel is open. |
| Workbench panels (`WorkbenchPanels.tsx`), Rig panels (`RigPanels.tsx`) | 15 s | **kept polling** | paused, one catch-up | Same kind of host call. |
| Mobile devices panel (`MobileDevices.tsx`) | 1.5 s | **kept polling** | paused, one catch-up | Only while that panel is open; the fastest poll in the app. |
| Editor external-change check (`EditorPanel.tsx`) | 2.5 s local / 8 s remote, per open editor | **kept polling** | paused, one catch-up (also checks on window focus, as before) | One stat/read per open editor per tick. |
| Sidebar "last updated" age (`Sidebar.tsx`) | 15 s, only while the stale/refreshing banner is shown | kept ticking | paused | Display only. |
| Terminal quiet alerts (`TerminalAlerts.tsx`) | 1 s per terminal, **only when "quiet alerts" is on** | runs | runs (unchanged) | Must run in the background: its purpose is to notify when the window is not looked at. |
| Terminal reconnect countdown (`TerminalReconnect.tsx`) | 250 ms, **only while a reconnect is pending** | runs | runs (unchanged) | Short-lived; the retry itself must continue. |
| Debounces (`saveState` 350 ms, search 200-300 ms, toast 4.5 s) | one-shot | n/a | n/a | Not polling. |

## Main process timers

Only one-shot timers (shutdown wait, startup probes, the update check). The update check runs on
`workspace.updateCheckHours` (default 6 h; 0 = never) and is skipped for unpackaged builds. No
repeating main-process poll was found outside terminal and inventory work triggered by the renderer.

## What changed

`src/visible-interval.ts` (`visibleInterval(fn, ms)`) skips ticks while `document.hidden` and
runs one catch-up when the window is shown again. The task, workbench, rig and mobile panels,
the editor disk check and the sidebar age use it. Visible behavior is unchanged; hidden windows
now stay idle, as the inventory poll already did.

## Not changed / worth a human look

- With the window visible, each open editor still polls its file every 2.5 s (local). That is
  by design (external edits by agents); a file-watcher would be a larger change.
- xterm.js and Monaco have their own internal timers (cursor blink, rendering). Cursor blink
  already stops for reduced motion (X11); other internal timers were not audited.
- Real CPU numbers need a display: with 10 terminals and 3 editors open, compare Task Manager
  / Activity Monitor CPU for the window visible vs minimized for a minute.
