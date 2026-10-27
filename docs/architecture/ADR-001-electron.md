# ADR-001: Retain Electron and isolate application services

Status: accepted by the user on 2026-10-27.

HRig's primary purpose is a graphical OpenRig workspace with terminals, Monaco editing, docked/popout panels and local/WSL/SSH sessions. Keep Electron rather than migrating to Tauri, a native UI rewrite or a VS Code fork without measured evidence that the current runtime prevents the product's goals. Installer/update polish is a distribution concern and does not require a framework migration.

## Boundaries

- `src/` owns React UI, docking, editor buffers and explicit user actions. It calls the preload contract, not Node/Electron directly.
- `electron/backend.cjs` is an Electron-independent application-service facade for inventory, tasks, file operations, revision-safe editing, project discovery and message delivery. `core.cjs` and `features.cjs` retain transport/CLI contracts and policy checks. Other clients can reuse these service boundaries without importing windows or renderer state.
- `main.cjs` and preload are host adapters: trusted IPC, windows, PTY ownership, notifications and lifecycle. Shell selection is in `platform.cjs`; credential storage remains injected into the integration service. Update host integration is in `update-adapter.cjs`, while `update-service.cjs` owns a testable state machine without Electron.
- OpenRig owns agents, permissions and task coordination. Neither packaging nor update tests start/stop/delete/message live rigs.

This is incremental separation, not a claim that a standalone daemon or a network API has been implemented. Keep new operations behind these interfaces; extract a separate service process only when a real client/deployment requirement warrants it.

## Performance evidence

`scripts/benchmark.mjs` measures one fresh application process for each 0-, 12- and 24-terminal workspace, editor/settings opening, summed Electron working sets and a two-second idle CPU sample. Cases use disposable local shells, not agents. The OS filesystem cache is shared, so these are fresh-process timings rather than controlled cold-machine boot tests. Shared pages can be counted more than once in summed working sets; external shell/agent memory is excluded. Hardware and OS context are included in each report.

Publish the baseline before setting regression budgets. Compare later runs on comparable hardware and investigate measured regressions before choosing a different framework. No RAM/startup advantage for a migration is assumed without a representative prototype and equivalent measurements.
