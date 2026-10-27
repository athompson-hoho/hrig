# Installation, updates and signing

Electron remains HRig's desktop runtime. Installed and portable downloads are independent packaging choices.

## Installed applications

Windows publishes an assisted per-user NSIS installer and a separate portable EXE. The installer supports a chosen directory, Start Menu/Desktop shortcuts and uninstall without deleting application data. It does not request elevation. CI installs into a temporary directory, launches the installed application, uninstalls it and verifies an application-data sentinel survives. That test is restricted to disposable Windows CI.

macOS publishes DMG and ZIP for Apple Silicon/Intel. Linux publishes AppImage, tar.gz, DEB and RPM for x64/ARM64. Package metadata and update-feed SHA-512 hashes are verified before publication. Runtime/user-data locations stay compatible with existing releases; encrypted credentials remain machine-specific.

## Updates

Open **Settings > Updates**. Packaged apps check 10 seconds after startup and every six hours. A new stable version prompts the user, with a 24-hour reminder for that version. Downloads and installation require explicit actions; there is no automatic download or install-on-quit behavior. Release notes are displayed as plain text. Manual checks use only the fixed public HRig GitHub release endpoint; users cannot configure arbitrary update servers in the UI.

From 0.12.0, packaged Windows apps can download and install updates from Settings or the new-version prompt. Unsigned Windows builds require explicit acknowledgment before installation; SHA-512 download checks protect integrity, not publisher identity. Signed builds retain native signature verification. Portable Windows copies open the per-user setup installer; the original portable file remains and users should use the installed app afterward. Portable launch environment flags are removed before setup is started. Signed macOS builds retain in-app installation. Unsigned macOS, Linux and development builds use downloads/package managers. Existing versions need a one-time manual upgrade to 0.12.0 to acquire this behavior.

electron-updater handles artifact checksum verification and, for signed builds, platform code-signature verification. Every OS/CPU has its own update channel to prevent the Intel/ARM metadata collision. Downloading cannot restart HRig. Installation requires a separate confirmation, then an IPC handshake with the workspace: unsaved buffers reject the restart; workspace persistence must succeed; the UI is made inert before acknowledging readiness. Only then may the host adapter call quitAndInstall. A normal beforeunload prompt alone is insufficient because the updater can spawn the installer before app.quit. Errors restore the interactive workspace, and existing OpenRig agents are never restarted by the update flow.

## Signing credentials (prepared, not configured)

Set these **GitHub repository Actions secrets**, never commit them to files or preferences:

| Platform | Required secrets |
|---|---|
| macOS | `MAC_CSC_LINK` (base64 Developer ID Application P12), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | `WIN_CSC_LINK` (base64 code-signing PFX/P12), `WIN_CSC_KEY_PASSWORD`, `WIN_PUBLISHER_NAME` (exact certificate simple publisher name) |

The workflow exposes each platform's signing credentials only to its native packaging step. It maps macOS secrets to electron-builder's CSC variables, requests notarization, and validates codesign/stapling. Windows validates Authenticode status and publisher on both the application and installer. Partial signing configuration fails instead of silently publishing an unsigned build. A generated, bundled release policy records whether signing was requested; publication requires the corresponding signature checks to pass. Credentials were explicitly left for later by the user. Hardware/cloud signing services would need their own adapter rather than pretending a PFX is available.

Until credentials are configured and a signed release passes native CI, macOS remains unsigned/unnotarized and macOS in-app installation remains disabled. Windows checksum-verified unsigned installation requires explicit user consent. Linux repositories/GPG signing are not configured; use explicit package downloads or a separately managed package repository.

## Release gates

The native workflow checks backend/unit contracts, production build, distribution manifests, update-feed hashes, configured signatures, packaged runtime behavior, Windows install/uninstall, and a 0/12/24-terminal performance baseline. It publishes distributions, architecture-specific feeds/blockmaps, combined checksums and native QA evidence only after every target succeeds. OS signing/notarization cannot be established with mocks; those checks run only with real credentials.

References: [electron-builder v26 updates](https://www.electron.build/v26/docs/features/auto-update/), [NSIS configuration](https://www.electron.build/v26/docs/nsis/).
