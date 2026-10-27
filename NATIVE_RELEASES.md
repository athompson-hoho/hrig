# Native desktop builds

Supported targets: Windows x64 portable EXE; macOS arm64/x64 DMG + ZIP; Linux x64/arm64 AppImage + tar.gz. Build each OS/architecture on a matching host. Native terminal dependencies are rebuilt for Electron on Unix. Packaging does not publish automatically.

On a native host, install Node.js 22 and the compiler prerequisites for node-pty, run `npm ci`, `npm run build`, then `node scripts/package.mjs`. For local smoke checks run `node scripts/smoke-native.mjs`; headless Linux requires `xvfb-run -a node scripts/smoke-native.mjs`. The smoke uses its own temporary project/data and a local OpenRig fixture, never real rig mutations. The Windows-specific development regression suite remains available separately.

The **Native desktop release** GitHub Actions workflow runs the five supported native hosts and uploads their distribution manifests and packaged QA evidence. All targets must succeed before its publish job creates/verifies the version tag and publishes artifacts, full notes, a combined checksum file and NATIVE-QA.json. Dispatch it on a committed release source with the package version and matching `releases/vVERSION.md`. The legacy Windows-only publisher is retained for historical releases; use this workflow for native-matrix releases.

macOS signing/notarization is not configured. These are unsigned desktop downloads; no claim of Gatekeeper/App Store approval is made. Linux without a functioning encrypted desktop keyring cannot store a Linear key; `basic_text` is deliberately rejected. Native CI establishes packaged runtime behavior on its listed runner OS, not every desktop distribution, permissions flow or display server.

Build references: [electron-builder native multi-platform constraints](https://www.electron.build/docs/features/multi-platform-build/), [GitHub native runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
