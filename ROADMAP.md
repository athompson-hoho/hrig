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
