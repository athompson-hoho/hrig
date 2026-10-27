# hRig 0.2.0 preview 1 - Approve and remember your phone

The mobile app is now named **hRig**. This preview adds desktop-controlled pairing, encrypted device credentials and a TLS connection pinned to your own computer. It is a prerelease for evaluation, not a production-signed mobile release.

## Downloads

- **hRig-0.2.0-preview.1-android.apk**: Android API 26+, debug-signed; application ID `dev.hrig.companion`, version code 2. It can update the previous Android preview when the debug signing certificate matches.
- **hRig-Mobile-Host-0.2.0-preview.1-windows-x64.exe**: matching unsigned portable Windows host preview, derived from desktop 0.9.0 with the mobile pairing settings added. Close any running desktop hRig before starting it. Existing workspace connections remain available.
- **hRig-0.2.0-preview.1-SHA256SUMS.txt**: checksums for both downloads.
- The tagged source includes the mobile client, Android/iOS projects, host gateway, tests and setup documentation. iOS and other desktop host builds are source-only in this release.

The previously published stable desktop builds do not expose the new pairing controls. Use this matching host preview or build the desktop from this release's source. This prerelease does not update or replace the stable desktop update feed.

## Pair a phone

1. On the matching Windows desktop build, open **Settings > Mobile devices > Start mobile access**, then **Pair a phone**.
2. On the phone, choose **Scan QR code**, or use **Enter pairing details** to paste the desktop invitation.
3. Review the computer, name the phone and request approval. Compare the verification phrase on both screens, then approve the phone on the desktop.
4. hRig stores the device credential in native secure storage and reconnects after app restart. Disconnect keeps the saved computer; Forget removes its credential from that phone. Revoke on the desktop blocks that device independently.

Mobile access listens on IPv4 port **5182** only after you start it. Both devices must be able to reach that port over LAN or Tailscale; allow it through the appropriate Windows firewall/tailnet policy. hRig does not change those policies automatically. Desktop mobile access stays off after desktop restart until you start it again.

## Pairing boundaries

Invitations last two minutes, can be used once and require desktop approval. Pending approvals expire in five minutes; cancellation from the phone removes the pending request. Each approved phone has its own credential, expiring after 90 days. The host stores credential verifiers rather than raw device credentials. Android encrypts profiles using a Keystore key; the iOS source uses Keychain. Native bridge logging is disabled to keep credential-bearing calls out of debug logs.

Invitations carry the host's certificate fingerprint. The phone checks that exact TLS certificate before sending credentials, including when trying a saved LAN or Tailscale address. Scan or copy invitations directly from your own desktop and keep them private. No cloud pairing service, Tailscale API keys, automatic agent launches or automatic message retries are introduced.

## Validation

Backend checks cover invitation expiry/replay, guessing limits, cancellation, denial, persisted verifiers, independent revocation, and keeping approval off the network API. Real Electron tests cover the desktop pairing controls and existing settings. Pixel emulator checks cover native pinned TLS/manual pairing, matching verification phrases, encrypted Android storage, restart reconnect, wrong-certificate rejection, revocation, cancellation and credential-log suppression. Camera denial and scanner launch were checked. All test rig data is isolated; no live agents receive test instructions.

## Known limitations

Real-camera QR capture, physical-device LAN/Tailscale switching and iOS compilation/device behavior remain unverified. Terminal screens remain read-only. Device discovery is limited to invitation/saved addresses; changed addresses may require a new invitation. The legacy shared-key HTTP connection remains available for the old standalone gateway but does not offer per-device approval/revocation. Browser clients cannot use the native pinned-certificate pairing flow. The included Android APK uses a development signing key; later production signing may require uninstalling it before upgrading. The Windows host is an unsigned preview. macOS/Linux matching host packages and an iOS binary are not attached.

## Integrity and source

Check downloads with `Get-FileHash -Algorithm SHA256 -LiteralPath '<download>'` and compare with the checksum file. Source is attached to tag `mobile-v0.2.0-preview.1`; the Android client assets are verified against a fresh source build before publication. The future mobile roadmap is included in `ROADMAP.md`.
