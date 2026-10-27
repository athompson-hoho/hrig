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

## Next desktop roadmap - awaiting approval

Proposed after the 2026-10-27 QA pass; **HR-11, HR-12 and HR-17 were approved and are implemented for 0.8.0; HR-13 is approved for 0.10.0; HR-14 through HR-16 and HR-18 through HR-20 remain awaiting approval**. Rank reflects reliability and everyday value first, then implementation cost and dependencies. Existing docking, floating, popouts, arrangement undo, role templates, project discovery and community themes remain the baseline. Evidence and QA limits: [QA review](docs/QA-2026-10-27.md).

| Rank / ID | Proposed improvement | Why now / evidence | Effort | Acceptance for approval |
|---|---|---|---|---|
| 1 / HR-11 | Honest connection and failure states | QA reproduced Connection Doctor showing its loading indicator after a rejected request. Inventory failure also clears the previous snapshot. | S-M | Doctor stops loading on failure and offers retry. Panels distinguish loading, empty, failed and stale; preserve last successful inventory with its timestamp and a clear stale label. Disable actions requiring fresh targets. Test rejection, timeout, recovery and host switching. |
| 2 / HR-12 | Crash recovery for unsaved files | Current editor buffers survive panel rearrangement but live only in memory; normal close protection cannot cover process crashes. | M | Atomic local recovery snapshots scoped by connection/project/file; restore-or-discard prompt after forced exit; compare with current disk revision before saving. Include Save All. Bound storage, provide clear/delete controls, and document that drafts may contain sensitive text. Never silently overwrite disk or reconnect to run commands. |
| 3 / HR-13 | Terminal find, links and output export | Terminal currently loads only FitAddon; there is no dedicated find UI, link provider or output export. | S-M | Find next/previous with case and regex options, match count, copy selection/all and explicit plain-text export. Confirm external links and resolve file links inside the attached project. Preserve PTY identity, keyboard input and scroll position; never send search text to the shell. |
| 4 / HR-14 | Recent and favorite projects | One-click live rig folders exist, but state stores only one current root per connection. | S-M | Searchable recent/favorite folders labeled by host and rig; pin/remove entries; remember layout per project. Validate before opening and explain unavailable hosts/folders without losing the current project or edits. |
| 5 / HR-15 | Session and panel navigator | Arranger and docking work; large workspaces still need a faster way to locate an already-open panel across groups/popouts. | M | Search open panels by rig, seat, file and host; MRU switcher; focus existing docked/popout panel rather than creating a duplicate. Add named groups and keyboard move-to-group/split commands using existing arrangement undo. Preserve unsaved text and existing agent sessions. |
| 6 / HR-16 | Better project search and Quick Open | Current content search is literal/case-insensitive with a 200-match cap; filename search returns at most 100 entries. | M | Case/whole-word/regex and include/exclude filters, grouped file/line results, explicit partial-result indicators, cancellation and stale-response protection. Quick Open supports fuzzy paths, arrow-key result selection, retaining the existing first-file Enter action. Keep traversal/file-size protections and test large projects over WSL/SSH. |
| 7 / HR-17 | Durable message and review drafts | Message composer/history are component state; review drafts are an in-memory map. A restart discards them. | M | Restore drafts by exact host/rig/seat/project; preserve text through panel moves, restart and failed sends. Display sending, accepted by OpenRig, failed or unknown outcome accurately. Anchor review notes to the reviewed revision and flag stale diffs. Never auto-resend after uncertain delivery or claim the agent read a message. |
| 8 / HR-18 | Everyday Git actions | Source control currently provides status/diffs; staging and committing still require a shell. | M-L | Per-file stage/unstage, staged/working diff selection, branch/status summary and explicit commit form. Refresh exact repository state before mutation; retain Git stderr and commit text on failure. Cover spaces, renames and WSL/SSH. Exclude reset, force-push, automatic staging and automatic commits from this milestone. |
| 9 / HR-19 | Configurable shortcuts and accessibility polish | Shortcuts are hardcoded in App; settings lists them but cannot edit bindings. Shared modal focus handling and status announcements need broader checks. | M | Search/edit/reset bindings with collision detection; app commands respect editor/terminal input and IME composition. Keyboard-only navigation through arranger, wizard and settings; focus-visible controls, announced errors/status, and modal trapping limited to visible enabled controls. Verify Windows Narrator, high contrast and 200% scaling. |
| 10 / HR-20 | Project-aware code intelligence | Monaco provides editing and bundled JS/TS workers, but there is no project language-server lifecycle or remote project service. | L | Start with opt-in TypeScript/JavaScript project support: imports, go-to-definition, references and diagnostics using actual project configuration. Pilot Python through a separately configured server after the first slice passes. Show server status/errors, constrain workspace access, never install or execute project tooling without explicit consent, and prove WSL/SSH cleanup on detach. |

Suggested delivery order, subject to approval:

1. **Reliability:** HR-11, HR-12 and HR-17. Failure-state cleanup first; shared draft storage before message/review persistence.
2. **Daily workspace:** HR-13, HR-14, HR-15 and HR-19. Preserve the working docking/session foundation while reducing clicks.
3. **IDE depth:** HR-16, HR-18 and HR-20. Ship search and safe Git actions before the larger language-service work.

Release numbers and dates remain unassigned. Each batch requires the existing release gates plus targeted acceptance checks above. Before calling remote support production-validated, add a disposable SSH-host journey (authentication failure, reconnect and port forwarding); notification delivery, Narrator/scaling and real mobile LAN/Tailscale/iOS checks remain explicit deployment gates. No proposed item authorizes starting, deleting or messaging a user's live rig during QA.

## Rig team architect backlog

Direct provider assessment, evidence-backed recommendations and targeted follow-up questions are implemented. The items below remain saved for later prioritization unless explicitly marked implemented.

| ID | Backlog item | Acceptance |
|---|---|---|
| TA-01 | Distinct proposal strategies | Lean, Balanced and Throughput differ in ownership, parallelism and review depth; identify a preferred option and explain tradeoffs. |
| TA-02 | Staged execution | Separate responsibilities from active processes; activate later roles at handoff gates and enforce a concurrency limit through OpenRig-supported orchestration. |
| TA-03 | Recommendation tuning — implemented | Balanced, lower usage, stronger verification and faster completion priorities feed direct and portable assessments. Manually edited seats remain protected across reassessment and application, including renames and handoff edits; protection can be explicitly released. |
| TA-04 | Solo recommendation | Recommend one agent with review checkpoints when team coordination would cost more than it contributes. |
| TA-05 | Work-shape analysis | Use coupling and independently verifiable task boundaries rather than repository size to justify parallel implementation. |
| TA-06 | First-handoff preview — implemented | Inspect per-seat mission, boundaries, required evidence and handoff conditions in proposals; edit with seats and review before launch. Plans persist in the rig summary; task dispatch remains explicit. |
| TA-07 | Reassessment diff | Compare proposed seats, runtimes and responsibilities against the current design before applying changes. |
| TA-08 | Outcome feedback | Collect optional usefulness feedback and observed resource pressure/blocked handoffs to improve future recommendations. |

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

### 0.6.2 - Match the rig designer to HRig

Reworked the wizard around existing tool-panel styling: compact heading and steps, shared control styling and surface tokens, smaller choice/seat layouts, flat review rows, and responsive form columns. Removed separate studio branding, gradients, shadows, and the rounded outer frame. Existing preview and confirmation behavior stays intact.

Validation: isolated production build, Electron designer workflow (including narrow-panel overflow, revision, preview, launch and deletion confirmation), wide/narrow screenshot review, and packaged native-terminal/editor/doctor/Git smoke test passed. Fresh README screenshots match this version.

### 0.7.0 - Full settings and coordinated theming

Delivered 33 searchable, working preferences with user/project overrides, modified filters, defaults/reset, JSON import/export, shortcut reference and About. Implemented five themes plus OS following across app surfaces, Monaco, xterm, and popouts; accent, font, density and reduced-motion options; editor/diff controls; live terminal preferences and local shell selection; refresh frequency, connection/rig defaults and notifications. Settings do not bypass agent policy or unsaved-file protection. See SETTINGS.md for the design rationale and catalog.

Regression investigation: the retry journey exposed repeated identical failures being batched into an unchanged error state. Retry scheduling now tracks failure events independently and keeps the existing six-attempt cap.

## Mobile companion release proposals

Companion versions below are independent of desktop versions. These are proposed milestones, not promises of availability. The current Android build is a debug preview; iOS is a generated project, not a tested release. Prioritize trustworthy connections and clear action results before adding more remote controls.

| Companion release | Outcome | Features and improvements | Acceptance gate |
|---|---|---|---|
| 0.1 preview | Try the companion | Existing rig/seat list, read-only terminal capture, tasks and explicit agent messages; downloadable Android debug APK with checksum, matching gateway source, setup instructions and an honest limitations list. | Build and gateway tests pass; Orca Android emulator journey passes; artifacts identify their source and signing type. Mark as prerelease. iOS remains source-only until tested. |
| 0.2 | Connect reliably from anywhere | Desktop companion settings with start/stop, exact reachable URLs and firewall diagnostics; QR pairing; separate expiring credentials per device; revoke one phone; saved host profiles; reconnect with backoff; last-success time and clear stale/offline states. Store persistent credentials in platform secure storage. | Real Android and iPhone can connect over LAN and Tailscale. Wrong, expired and revoked credentials fail. Sleep, network switching and host restart recover without resending messages. The UI never labels stale data as live. |
| 0.3 | Work comfortably from a phone | Opt-in interactive terminal attachment; touch keyboard accessory for Escape, Tab, Ctrl and arrows; scrollback search/copy; readable font controls and landscape/tablet layouts. Keep read-only viewing as the default. | Attach only to the selected existing managed seat; disconnect never stops the agent. Test keyboard composition, resize, background/resume and bounded output buffers. Never replay terminal keystrokes after an uncertain disconnect. |
| 0.4 | Review work away from the desk | Read-only project browser and Git diffs; file/line feedback addressed to a chosen seat; task detail, filters and task creation; message draft preservation and explicit delivery state. Start with review before mobile file editing. | File access stays within the configured project. Review comments reference the actual diff revision. Failed or uncertain sends retain drafts and require deliberate retry. Mutations respect advertised OpenRig capabilities and ownership. |
| 0.5 | Keep track of a team | Rig/seat favorites, cross-rig attention inbox, optional notifications for attention/blocked work, project preview links, tablet split view and quick actions such as “Request an update.” | Notifications are opt-in, deduplicated and contain no sensitive terminal text by default. Actions show recipient and payload before sending. Preview access uses explicit port allowlists and honors host/network policy. |

### Pairing proposal for mobile release 0.2

The app's display name is **hRig** on Android, iOS and the mobile web UI. Installed application IDs stay stable so a name change does not create a second app. The core pairing flow is delivered in the [0.2.0 prerelease](https://github.com/athompson-hoho/hrig/releases/tag/mobile-v0.2.0-preview.1), with an Android debug APK and matching Windows portable host: desktop TLS controls and approval, QR invitations and manual fallback, per-device credentials, native secure storage, reconnect and revocation. The old shared-key form remains a legacy option. Real-device validation is still required before a stable release.

1. **Start from the desktop:** Settings > Mobile devices > Pair a phone. hRig starts or checks the gateway, displays the computer name, and offers LAN and Tailscale addresses with a reachability explanation. No terminal command or manually copied long key should be needed for the standard flow.
2. **Scan from the phone:** the first screen offers Scan QR code, Enter pairing details, and saved computers. QR is the primary path; manual pairing stays available when camera access is declined or scanning fails. The QR contains a protocol version, gateway identity, candidate addresses, and a short-lived, single-use invitation, never the host's persistent shared credential. Show the countdown and allow Cancel or Generate new code.
3. **Confirm the computer and phone:** the phone displays the host name and requested access. The desktop displays the requesting device and a matching short verification phrase. The user approves on the desktop before the invitation can grant access. Device names and source addresses are hints, not proof of identity. Use authenticated TLS/host identity verification for the exchange; scanning a QR alone does not make arbitrary LAN HTTP safe.
4. **Remember this device:** exchange the invitation for a unique credential scoped to this host and approved permissions. Store the phone credential in iOS Keychain or Android Keystore-backed storage; persist only its verifier and metadata on the host. Issued sessions have expiry and revocation rules. The first implementation can default to monitor-and-message access, with broader controls approved separately if introduced later.
5. **Reconnect naturally:** save the host profile and last working address, test bounded LAN/Tailscale candidates after network changes, and reconnect without another scan while authorization remains valid. Clearly distinguish Connecting, Connected, Offline with last update time, and Approval expired. No successful UI state until the authenticated host replies. Network changes never replay messages or keystrokes.
6. **Manage devices:** show paired phones, approval date, last connection and permissions in desktop settings. Revoke one device or all devices. On the phone, Disconnect ends the current connection while retaining the host profile; Forget this computer removes its saved credential and profile. These actions must have distinct labels and predictable effects.

**Recommended manual fallback:** enter or paste the host address and a fresh one-time invitation shown on that desktop. A six-digit code alone is insufficient as a long-lived credential: any short-code mode needs a short expiry, strict host-wide and per-invitation attempt limits, cancellation and desktop approval. Avoid silently discovering or trusting other tailnet hosts; native Tailscale setup stays in the Tailscale app.

**Diagnostics that help:** identify host unreachable, gateway stopped, LAN isolation/firewall, invitation expired or already used, approval denied, revoked device, and incompatible host version. Provide one clear next action for each. Diagnostic exports omit invitations, credentials, terminal content and sensitive network details by default.

**Ship in slices:** first add desktop gateway controls and the matching phone connection states; then invitation/approval APIs and secure device storage; then QR scan/manual fallback; finally reconnect, revocation and real-network validation. Test camera denial, expiry, replayed invitations, guessing limits, host impersonation, two simultaneous phones, host restart, revoked credentials, Wi-Fi/cellular transitions and lost approvals. Validate on real Android/iPhone devices over both LAN and Tailscale before calling pairing complete.

Implementation evidence: [pairing store](electron/mobile-pairing.cjs), [desktop TLS service](electron/mobile-service.cjs), [desktop controls](src/MobileDevices.tsx), [phone pairing](mobile/PairComputer.tsx), and native pinned transports/secure storage in the Android HrigLink plugin and iOS AppDelegate. Backend guards and the real Electron settings journey cover invitations, approval, expiry, rate limits, persistence, denial, cancellation and revocation. Pixel emulator checks exercised pinned TLS/manual pairing, a matching phrase, wrong-certificate rejection, encrypted Android storage, cold-start reconnect and revoked access. Real QR camera capture, physical LAN/Tailscale switching, and iOS native build/device validation remain open. The Android application ID remains `dev.hrig.companion`; its displayed name is hRig.

### Feature priority list

- **Next:** validate pairing on physical Android/iPhone devices over LAN and Tailscale, including real-camera QR capture and network switching. The prerelease now includes the desktop gateway controls and matching Windows host. A polished connection flow is more valuable than adding controls to an unreliable connection.
- **After connection reliability:** interactive terminals and review/diff workflows offer the largest practical improvement over the current monitor-and-message client.
- **Useful smaller improvements:** rig/seat search, task filters, copyable connection diagnostics with secrets removed, accessible labels and larger text, clear loading/empty/error states, and a host/version compatibility check during pairing.
- **Later experiments:** voice-to-message drafts, user-editable prompt shortcuts, notification quiet hours, and a desktop-to-phone “continue reviewing” link. Voice transcripts and shortcuts must remain editable drafts until the user sends them.
- **Keep deliberate:** stop/delete/start actions need fresh target identity and explicit confirmation. Avoid automatic agent launches, queued destructive actions, automatic message retries, public terminal URLs, and embedding Tailscale account credentials in the companion.

### Current mobile evidence

- Client: [mobile/main.tsx](mobile/main.tsx); constrained network boundary: [mobile-gateway.cjs](electron/mobile-gateway.cjs).
- Automated checks: [gateway guards](tests/mobile.test.cjs) and [phone-sized UI journey](tests/mobile/companion.spec.ts).
- Android debug APK built and exercised through Orca on Medium Phone API 37 and the rebuilt Pixel 10 Pro XL emulator: pairing, session/terminal viewing, tasks and a fixture-confirmed message. Rotation, key rejection, disconnect and process-restart pairing were also checked on the first emulator.
- Remaining release evidence: real devices over LAN/Tailscale, iOS build/device checks, release signing and update continuity, and reproducible artifacts tied to the published source. Emulator results do not establish real-network or iOS behavior.

Validation: 14 core/WSL checks and all 18 desktop journeys passed after the retry fix. The packaged native-terminal/editor/doctor/Git smoke and packaged settings/theme capture passed. Real editor options, session continuity, system appearance, project scope persistence/reset, import rejection, shell defaults, narrow layouts and popout theming are covered. README screenshots were captured from the packaged desktop app.

### 0.7.1 - Community theme adaptations

Added all four Catppuccin flavours, Nord, Dracula, Tokyo Night and Gruvbox Dark, with pinned upstream palettes and bundled licenses. Community previews, native/default accent selection, coordinated syntax and complete ANSI palettes, independent terminal selection, scoped persistence and popout updates are implemented. Core palette anchors and secondary UI contrast are tested.

Validation: production build, 15 core/WSL/palette checks, all 19 Electron journeys, visual review of community previews, and packaged native-terminal/editor/doctor/Git smoke tests passed. Verified all five upstream license texts, source provenance and theme credits are present in the application archive. Community tests cover exact palette anchors, syntax colors, full ANSI tables, native accents, independent terminal selection, session continuity, project reset, restart persistence and popouts.

### 0.8.0 - Approved reliability batch and project boards

HR-11, HR-12 and HR-17 were approved together. Implemented Doctor terminal failure states, endpoint-scoped last-good inventory with stale labels and guarded recipients/actions, atomic bounded file recovery, explicit restore/discard, Save All, and durable messages/reviews with recipient/revision checks and no automatic send replay. See [recovery behavior](RECOVERY.md).

**HR-21 - Project boards and integrations (approved addition):** local task boards (create/edit/delete/status), GitHub Issues read/create/state changes, read-only GitHub Projects status boards, Linear encrypted-key connection/team/project/issues/workflow states, and deliberate linked OpenRig assignment. The user explicitly chose local boards plus GitHub and Linear. See [setup and boundaries](INTEGRATIONS.md). Remote provider writes require explicit confirmation; no live issue or rig was mutated for QA.

Validation: isolated production build, all 20 backend checks (including two mobile gateway checks), all 25 Electron journeys, mobile production build and its browser journey, development smoke, and packaged Windows smoke passed. Packaged checks include native PTY, Monaco, doctor, Git, local board creation/status, draft IPC and a real Windows encryption roundtrip. Dependency audit reported zero vulnerabilities. A real authenticated GitHub repository read passed; provider writes and OpenRig assignments use fixtures. Packaged board screenshot was visually reviewed and added to README. HR-11, HR-12, HR-17 and HR-21 are delivered in 0.8.0. The remaining seven original proposals still await approval.

### 0.8.1 - Native desktop distribution

User requested macOS and Linux releases. Added native five-target build/QA/publication workflow, macOS DMG/ZIP and Linux AppImage/tar.gz targets, Unix login shells/OpenSSH/local OpenRig support, platform-aware shell settings, macOS application menu and secure-store fallback detection. Full artifacts are gated on matching native runner checks; workflow evidence is attached to the release. Apple signing/notarization and non-runner desktop deployment checks remain explicit limitations. See NATIVE_RELEASES.md.

Native release validation: all five targets passed unit/build/packaged smoke gates in [workflow 40464745845](https://github.com/athompson-hoho/hrig/actions/runs/40464745845). Published v0.8.1 from `bce6937fe45a805efcea7e4a5ec066c6bef60bbf`; verified all nine application hashes and both metadata asset digests against GitHub. NATIVE-QA.json records matching tagged source, CPU architecture, real PTY/editor/conflict checks, board/draft restart and fixture-only local Unix inventory. The first native pass exposed an editor URI canonicalization error for Unix roots; the corrected native run passed. Local Windows coverage: 25 UI journeys passed before the URI correction, followed by seven targeted editor/theme/reliability reruns after it. One WSL backend check timed out during concurrent suites and passed an isolated rerun without changing the test. The draft-publication visibility race was recovered by rerunning only the publish job; future publisher creation uses the REST response ID directly.

### 0.9.0 - Electron long-term foundation (approved)

The user approved retaining Electron with a modular application-service boundary, installed distribution/update polish and measured performance. Added an Electron-independent backend facade, host update adapter and testable update state machine; a per-user Windows installer; Linux DEB/RPM; architecture-specific feeds; signing/notarization configuration and explicit restart protection; fresh-process 0/12/24-terminal benchmarks. Signing credentials are explicitly deferred by the user: unsigned/portable/Linux builds retain manual updates and do not enable in-app installation. CI gates installer lifecycle, feed hashes, native runtime checks and benchmark evidence. See DISTRIBUTION.md and the accepted architecture decision. Validation: all five native targets passed backend/build/runtime, feed/package verification and performance gates in [workflow 40511570258](https://github.com/athompson-hoho/hrig/actions/runs/40511570258); Windows installed-app smoke and uninstall/data-preservation checks passed. All 26 local desktop journeys passed. Published v0.9.0 from `d10e89bc7ac6eca6a90c15cbf963cb3664f21597`, then independently verified release asset digests, checksums and tagged QA source. Signing is unconfigured on every target. See [performance baseline](PERFORMANCE.md).

### 0.10.0 - Terminal output tools (approved)

HR-13: terminal search with case/regex, capped match counts, next/previous navigation, copy selection/output and native plain-text export; confirmed browser links and project-confined file links using the original connection. Search leaves the PTY intact and does not submit text to the shell. See [terminal behavior and limits](TERMINALS.md). Validation: clean production build and all 28 desktop journeys passed, including real-shell search/case/regex navigation, clipboard, export/cancel, clickable project files, browser confirmation and shell-variable continuity. All 33 applicable backend checks passed (one Unix-only check skipped); the added soft-wrap export check also passed separately. Packaged/native release gates follow.
