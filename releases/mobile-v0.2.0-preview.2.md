# hRig 0.2.0 preview 2 - Reliable panes and complete task details

Install **both** the Android APK and matching Windows host. The host fixes terminal capture errors that updating the phone alone cannot resolve. Close the running desktop hRig before launching the portable host. Existing saved workspace connections remain available.

- **hRig-0.2.0-preview.2-android.apk**: Android API 26+, debug-signed, application ID `dev.hrig.companion`, version code 3. Updates preview 1 when the signing certificate matches.
- **hRig-Mobile-Host-0.2.0-preview.2-windows-x64.exe**: unsigned portable Windows host with the matching mobile gateway.
- **hRig-0.2.0-preview.2-SHA256SUMS.txt**: SHA-256 checksums for both downloads.

## Fixes

- Correct tmux pane targeting fixes errors opening rig terminal screens.
- Start on the desktop-selected connection instead of the first saved SSH connection.
- Inventory, tasks and screens load independently; one failing service no longer hides the others. Errors show retry controls and clearly marked last successful data.
- Show every seat, including seats missing a rig group, with model, activity, attention and stopped-session information.
- Open full task details, including complete body and all returned fields, with task search.
- Preserve message drafts across failed sends and navigation. Messages are never replayed automatically.
- Space pairing controls, wrap long metadata and keep expanded task fields inside the phone viewport.

## Pairing

On the matching host, open **Settings > Mobile devices > Start mobile access > Pair a phone**. Scan the invitation or paste it using **Enter pairing details**, compare the verification phrase, and approve on the desktop. Existing preview-1 approvals remain compatible. Mobile access uses pinned TLS on port 5182 over reachable LAN or Tailscale addresses; the app does not change firewall or tailnet policies.

## Validation

Seven gateway/pairing checks passed, including a real isolated WSL tmux capture and full task read. Five phone browser journeys passed. The actual rebuilt Android app passed emulator tests for all 12 fixture seats, full tasks, independent failures and recovery, session replacement, disappearing seats, connection switching, real keyboard input, preserved drafts, exactly one deliberate fixture message, rotation and empty states. Pairing controls and expanded task details were measured in the native WebView.

A separate read-only Android validation against the live Ubuntu connection loaded 3 rigs, all 12 terminal screens and 55 tasks, plus full details for three tasks. The validation host rejected message operations; no live agents were changed. The earlier canned screen fixture missed the pane-target bug; the new real-WSL regression covers it.

## Limits

This is an unsigned host and debug-signed Android prerelease. Physical-device LAN/Tailscale switching, real-camera QR capture and iOS build/device behavior remain unverified. Terminal views are read-only, showing the latest 200 lines. No rig lifecycle controls, file editing or notifications are added. iOS and other desktop hosts are source-only. This prerelease does not replace the stable desktop update feed.
