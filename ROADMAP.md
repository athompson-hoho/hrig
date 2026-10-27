# HRig delivery roadmap

This tracks the ten improvements approved in chat. OpenRig remains the owner of agents and coordination. HRig owns their graphical workspace. No roadmap operation may launch, stop, or message a live rig merely to test a feature.

| ID | Release | Improvement | Status | Acceptance |
|---|---|---|---|---|
| HR-01 | 0.2 | Visual workspace arranger | Done (0.5.0) | Layout thumbnails; move/split/group controls; equalize; reversible arrangement history without closing seats or losing edits. |
| HR-02 | 0.2 | Connection doctor | Done (0.5.0) | Check Linux Node, OpenRig, tmux, Python, authentication and daemon; initialize existing NVM inside the connection without changing shell profiles. |
| HR-03 | 0.2 | Session recovery | Done (0.5.0) | Bounded reconnect; stable seat identity; refresh session bindings; keep windows within connected monitors. |
| HR-04 | 0.3 | Attention center | Done (0.5.0) | Evidence-backed attention inbox; focus seat; optional deduplicated desktop notifications. |
| HR-05 | 0.3 | Role-based templates | Done (0.5.0) | Save arrangements by seat role; apply to another rig; explicitly show unfilled roles. |
| HR-06 | 0.3 | Interactive task board | Done (0.5.0) | Filter by state and owner; inspect details; create assigned work; open owner; supported coordination actions without fabricated seat identity. |
| HR-07 | 0.4 | Agent review workspace | Done (0.5.0) | Choose project and seat; inspect actual Git changes; collect file/line notes; explicitly send feedback to selected seat. |
| HR-08 | 0.4 | Everyday editor | Done (0.5.0) | Detect external changes; conflict-safe save; project text search; create/rename; editor diagnostics. |
| HR-09 | 0.5 | Preview and ports | Done (0.5.0) | Discover listeners; manually open ports; managed SSH forwarding; sandboxed preview panels; restore preview connections. |
| HR-10 | 0.5 | Graphical rig management | Done (0.5.0) | Discover specs; inspect topology; preview launch; explicitly confirm start/restore/stop; capability checks and actionable errors. |

## Release gates

1. TypeScript and production build pass.
2. Core and real Electron integration tests pass; transport tests use isolated WSL fixtures.
3. User project files, existing layouts, rigs, agent processes, and OpenRig policy remain intact.
4. A fresh Windows executable passes a packaged smoke test.
5. Each completed row links to implementation and validation evidence below; unimplemented scope remains visible.

## Implementation record

- Baseline: 0.1.0 desktop app; six core/WSL checks and seven Electron journeys. User confirmed live WSL discovery works.
- Completed: HR-01 through HR-10 integrated into HRig 0.5.0 and packaged as a separate Windows executable.

## Implementation evidence

The four planned milestone groups are integrated into the 0.5 preview; release numbers in the table retain the original dependency order.

- HR-01: [Arranger](src/ArrangeWorkspace.tsx), layout history in [App](src/App.tsx); six-session arrangement, history, equalize and template desktop journey.
- HR-02: [Connection diagnostics](electron/features.cjs); real WSL doctor/CLI-contract tests and doctor desktop journey.
- HR-03: [Terminal recovery](src/TerminalPanel.tsx), stable-seat lookup and display-bound recovery in [main](electron/main.cjs); replacement-session and off-screen window desktop journeys.
- HR-04: [Attention panel](src/WorkbenchPanels.tsx), opt-in deduplicated notifications in [App](src/App.tsx); explicit served-attention fixture journey.
- HR-05: [Role capture/binding](src/layout.ts); role-template save/apply desktop journey without duplicate agent launch.
- HR-06: [Task board](src/TaskBoard.tsx); actual WSL command transport against isolated task-create/detail fixtures. Handoffs are requests to the owner.
- HR-07: [Review workspace](src/ReviewWorkspace.tsx); real fixture Git changes, side-by-side diff/session, file/line notes and explicit fixture feedback delivery.
- HR-08: [Editor](src/EditorPanel.tsx), revision checks in [backend](electron/features.cjs); local/WSL stale-save rejection, external reload comparison, content search, create/rename, and diagnostics journeys.
- HR-09: [Ports and preview](src/WorkbenchPanels.tsx), managed SSH tunneling in [main](electron/main.cjs); real local HTTP preview test. Live SSH tunneling requires deployment validation.
- HR-10: [Rig manager](src/WorkbenchPanels.tsx), constrained capability-checked actions in [backend](electron/features.cjs); dry-run, typed launch/stop confirmation and snapshot receipts in isolated fixtures.

Tests: [core](tests/core.test.cjs), [file/lifecycle guards](tests/features.test.cjs), [WSL action boundary](tests/roadmap-wsl.test.cjs), [desktop roadmap journeys](tests/e2e/roadmap.spec.ts), plus the baseline desktop suite.

## Final validation

- Production TypeScript/Vite build passed.
- Nine core/WSL checks passed, including large-file stdin transport, revision conflicts, literal message payloads, expanded project paths, and capability/confirmation guards.
- Thirteen real Electron journeys passed, including six-session arrangement, bounded retries, review feedback, diagnostics, previews, window recovery, and baseline regressions.
- Development server smoke test passed.
- Packaged Windows smoke test passed: native PTY, bundled Monaco editor, preload/IPC, and connection doctor.
- Dependency audit reported zero vulnerabilities.
- Executable: `release/HRig 0.5.0.exe`. Existing 0.1.0 executable and live rigs were left intact.
- Deployment checks still required for a real SSH tunnel and Windows notification delivery; those implementations are present but the automated environment does not provide their live endpoints.

## Patch 0.5.1 — Git project selection

- Reproduced the reported failure against the active WSL folder: `/home/athompson` is not a Git repository.
- Added a structured non-repository state to the Git backend and a project-picker empty state in Source control and Review.
- Preserved actual Git stderr for genuine failures instead of hiding it behind `CalledProcessError` tracebacks. No Git repository, trust configuration or home-directory files are created by this fix.
- Added local/WSL regression tests for non-repositories and corrupt Git metadata, plus a desktop journey selecting a valid project after opening a non-repository folder.

Patch validation: 11 core/WSL checks and 14 desktop journeys passed, as did the production build and packaged native-terminal/editor/doctor/Git smoke test. Verified the active home-directory query returns a normal non-repository result. Executable: `release/HRig 0.5.1.exe`.

### 0.5.2 - Rig project picker

Implemented one-click project opening from live managed tmux session folders over WSL/SSH. Deduplicates shared paths, labels rig ownership, prioritizes the selected rig, and validates folders before switching. Manual entry and local Browse remain available. Covered by the isolated WSL backend fixture and a desktop journey that opens a discovered folder without entering a path.

Validation: production build, 11 core/WSL checks, 15 desktop journeys, and packaged Windows native-terminal/editor/doctor/Git smoke test passed. Portable executable: `release/HRig 0.5.2.exe`.

### 0.6.0 - Rig design wizard and deletion

- Added sidebar Manage rigs shortcut and per-rig deletion with affected seats, typed confirmation, fresh ID/name verification, snapshot request, and explicit handling of blocked or partial deletion.
- Added three-step needs/team/review wizard with build, research, review and product-design recommendations; solo/pair/team choices; installed agent selection and per-seat runtimes; and live project folder selection.
- Generated specs save exclusively to the project, preserve unrelated files and existing rigs, allow revision of the wizard's own saved design, and require a successful matching preview before launch.
- Verified a generated two-seat rig against installed OpenRig 0.6.14 with real --plan/preflight; no live rigs were launched, stopped or deleted. Destructive journeys use an isolated CLI fixture.

Validation: production build, 12 core/WSL checks (including blocked deletion, exact-ID targeting, preview receipts, safe design revisions and failed-preflight recovery), 16 desktop journeys, visual review of the designer, and packaged Windows smoke test passed. Portable: `release/HRig 0.6.0.exe`. Packaging supports `HRIG_PACKAGE_STAGING` for staging outside watched directories when Windows locks extraction renames.

### 0.6.1 - Rig Studio visual polish and private releases

Polished the rig wizard with a clear progress rail, keyboard-accessible work/team choice cards, responsive seat cards, a team roster summary, compact preview success state and expandable technical details. Kept warnings visible and launch/deletion confirmations intact. Established version-specific release notes, artifact checksums and an explicit publisher that verifies private visibility, tagged package versions and uploaded asset hashes before publication. All preserved versions are included; v0.1.0 uses an accurately labeled snapshot recovered from its original packaged app.

Visual update validation: TypeScript/Vite production build, the Electron designer journey (including card selection and narrow-panel overflow), rendered wide/narrow screenshots, and packaged Windows smoke test passed. Desktop release builds are isolated from concurrent mobile work.
