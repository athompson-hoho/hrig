# HRig Companion - Android preview

An early mobile companion for monitoring and messaging OpenRig sessions through an HRig Windows host. This preview uses a separate authenticated gateway over LAN or Tailscale. It is not a full mobile IDE.

## Available features

- List the WSL/SSH connections already saved on the HRig computer.
- Browse rigs and seats, inspect the latest terminal screen, and view active tasks.
- Send an explicit message to the selected seat through OpenRig.
- Disconnect without stopping the agent; the pairing key remains in app memory only.

## Install or upgrade

Download `HRig.Companion.Android.Preview.apk` from this prerelease. It is a **debug-signed test build**, with Android application ID `dev.hrig.companion` and current package version `1.0` / code `1`. It is intended for sideloading and evaluation. Future release signing may require uninstalling this preview before upgrading. No iOS binary is available.

On the Windows host, download and extract this release's source archive or check out tag `companion-android-preview.1`. Install Node.js 22 or newer, save a WSL/SSH connection in HRig, and open a terminal in the extracted source folder, then run:

```powershell
npm ci
npm run mobile:build
$env:HRIG_MOBILE_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:HRIG_MOBILE_TOKEN # Read privately before starting the gateway
$env:HRIG_MOBILE_HOST = '192.168.1.20' # Replace with this host's LAN or Tailscale address
npm run mobile:gateway
```

Enter `http://<host-address>:5180` and the key on the phone. For LAN access, the phone must reach the host and Windows firewall must allow the chosen port. For Tailscale, connect both devices to the tailnet and permit the connection in its access policy. See the README for HTTPS/Tailscale Serve and custom workspace-directory instructions. The portable Windows executable does not start this gateway automatically.

The key grants access to saved WSL/SSH connections, terminal screens and agent messaging. Plain HTTP on a LAN does not encrypt it or the session text; use a trusted network, Tailscale, or HTTPS. Rotate the key and restart the gateway to revoke access.

## Validation

The Android debug build was installed and exercised through Orca on Medium Phone API 37 and Pixel 10 Pro XL emulators. Verified native HTTP pairing, sessions, terminal viewing, tasks and fixture-confirmed message delivery. Additional checks covered invalid keys, rotation, disconnect and re-pairing after process restart. The mobile UI and gateway operation/authentication tests also passed. Fixtures never contact live rigs.

## Known limitations

Terminal screens are read-only snapshots, refreshed every four seconds. Interactive terminal input, project editing, mobile notifications, task mutations and rig lifecycle controls are not implemented. The gateway requires a separate Node.js process on Windows. Real-device LAN/Tailscale operation and iOS builds remain unverified. This preview has no production signing, store distribution, automatic updater, per-device credential revocation or durable message-delivery receipt protocol.

## Proposed next releases

The [mobile roadmap](https://github.com/athompson-hoho/hrig/blob/companion-android-preview.1/ROADMAP.md#mobile-companion-release-proposals) proposes reliable QR pairing and reconnects first, interactive terminals second, then project/diff review and task workflows, followed by an optional team attention inbox and notifications. These are planned improvements, not shipped capabilities.

## Integrity and source

Assets include `HRig.Companion.Android.Preview.apk` and `HRig.Companion.Android.Preview-SHA256SUMS.txt`. Verify the APK using `Get-FileHash -Algorithm SHA256 -LiteralPath './HRig.Companion.Android.Preview.apk'` against the checksum file. The [release source tag](https://github.com/athompson-hoho/hrig/tree/companion-android-preview.1) includes the matching client, gateway, native projects, tests and setup documentation. The APK's bundled client was compared byte-for-byte with a fresh build of this source before publication. This companion prerelease is versioned separately from desktop HRig and does not replace its latest stable release.
