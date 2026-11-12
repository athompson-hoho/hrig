# HRig privacy statement

Updated: 2026-11-09

HRig is a desktop workspace for OpenRig. It does not operate a hosted project-storage service, include advertising, or automatically upload product analytics or crash reports to the maintainer. It stores workspace data locally and communicates with hosts, services and agents selected by the operator.

## Local information

Settings, selected connection details, workspace layouts, per-file review checks, drafts/recovery copies, private seat notes, integration configuration, mobile pairing records and related local state are stored on the desktop computer. Drafts can contain unsaved source code and review/message text. Credential storage uses Electron's operating-system-backed encryption where the relevant integration supports it; CLI tools also maintain their own authentication stores. HRig's Windows uninstaller preserves application data, so uninstalling is not a credential or draft erasure operation. Use the applicable disconnect, device-revocation and saved-draft controls to remove those records. Private seat notes are plain text in the workspace file, are not encrypted and are never sent to a seat, a host or the settings export; clear a note from its dialog to remove it.


### Remembered session list (optional)

If you turn on "Remember the last session list" (off by default), HRig stores a copy of the last verified OpenRig session list for each connection (up to ten) in a file named `inventory-cache.json` in HRig's application data folder: rig, pod, session and model names, runtimes, status and activity text, work counts and last-activity times. Error text is not stored. Entries older than seven days are ignored. HRig shows the copy only as a last known snapshot with its original age and keeps session actions disabled until a live check succeeds. The file is created readable only by your account on macOS and Linux; on Windows it inherits the permissions of your user profile folder. Turning the setting off deletes the file. It is not uploaded anywhere, and uninstalling HRig does not remove it.

## Connections and agents

Opening or restoring a configured WSL/SSH connection can retrieve rig inventory, task state, host diagnostics and project metadata. Open terminals, task views and other configured panels may keep polling or exchanging data while the workspace is open. Messages, file changes and commands initiated through HRig are delivered to the selected host. SSH, OpenRig, the selected agent runtime and any services invoked by a command have their own configuration and privacy behavior.

An explicit AI assessment can send the project goal, constraints, current team and protected edits, follow-up answers, host CPU/memory metadata, provider-reported plan labels and operator-declared plan budgets, top-level project names and package dependency/script names through the selected provider CLI. An agent with project access can inspect additional files and transmit context according to its own permissions and settings. Review the generated brief and provider settings before submitting sensitive material. Copying a portable prompt and running it in another product is an operator-initiated transfer to that product.

## Optional network services

| Feature | Information and destination |
|---|---|
| GitHub release checks/downloads | Packaged HRig checks GitHub for updates after startup and every six hours; explicit downloads also contact GitHub download hosts. These services receive normal request metadata such as IP address. HRig does not automatically download or install an update at startup. |
| GitHub boards | Selected repositories, issue/project queries, and explicitly submitted edits are sent through the configured GitHub CLI account. |
| Linear boards | Requests and explicitly submitted work-item changes go to Linear using the configured account/token. |
| Agent providers | Provider requests and project context go to the configured runtime/provider when an assessment, agent task or related operator action invokes it. |
| Mobile companion | Approved devices communicate with the configured desktop endpoint. Pairing/discovery uses the local network or network route configured by the operator. The companion may expose terminal output and project/task information from the linked desktop to approved devices. |
| Project previews and external links | Opening a preview or link contacts its selected destination. Projects and pages shown inside previews have their own network behavior and policies. |

Applicable service policies include [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), [Linear](https://linear.app/privacy), [OpenAI](https://openai.com/policies/privacy-policy/) and [Anthropic](https://www.anthropic.com/legal/privacy). Provider account agreements, enterprise terms and policies of other operator-selected tools may also apply. HRig does not replace those services' policies or control their retention.

Community theme palettes are bundled locally. Selecting a bundled theme does not fetch a theme or send code to a theme service.

## Support and control

Disable or disconnect optional integrations, close configured connections/panels, and revoke mobile devices when they should no longer exchange information. Agent processes and remote services can continue independently of the HRig window; stop them through their own controls when appropriate. For privacy questions, contact the maintainer through the [project repository](https://github.com/athompson-hoho/hrig). Public issues must not contain credentials, private source code or personal information.

## Redacted diagnostics export

In Connection doctor, Export redacted diagnostics… explicitly saves a bounded local JSON file. Its log contribution is a represented check-status snapshot for eight fixed check labels, not raw application/host logs, historical logs or fresh host verification. Missing, invalid or duplicate check statuses become unknown. Absent, checking, failed, obsolete, malformed or oversized reports make check statuses unavailable; valid local versions and selected settings can still be exported.

The bundle includes only recognized numeric versions of the local HRig application, Electron, Chromium and Node.js, plus valid values from nine effective settings: `appearance.density`, `appearance.reduceMotion`, `editor.fontSize`, `editor.tabSize`, `editor.wordWrap`, `terminal.fontSize`, `terminal.cursorStyle`, `terminal.scrollback` and `workspace.refreshInterval`. Unknown version formats are unavailable; invalid settings are omitted. Settings accept only their fixed enum, boolean or bounded integer domains. No new preference is added.

The export omits check details, terminal text/recordings, arbitrary logs, environment values, workspace history, connection/account/project/pairing identities, credentials, budgets and free-form settings such as paths, fonts or commands. It constructs only the selected fixed fields; it does not scrub arbitrary logs or certify arbitrary content as secret-free. Export adds no diagnosis, host/network collection, polling, terminal reads/input, agent lifecycle action or upload. Opening Doctor and explicitly selecting Run checks retain their separate existing diagnosis behavior.

The native Save dialog chooses the destination. Choose a new file name: existing files are never replaced. Canceling saves no file. A failed write, existing destination or unsupported filesystem produces a generic error without a path or raw error; explicitly retry with a new name in a writable folder. Saved is reported only after the completed new file is published. Permission behavior, hard-link support and crash durability depend on the platform/filesystem and remain unverified on a real desktop; synthetic filesystem checks do not establish universal confidentiality or durability. HRig does not upload or automatically delete the saved bundle.

## Desktop notifications

Seat needs-input notifications require the explicit, reversible `notifications.desktop` preference, default `false`, with effective project overrides taking precedence over user settings. Earlier explicit opt-in is preserved when migrating a workspace without newer preferences. Settings and Attention center edit that same preference; enabling it does not certify native permission or delivery.

For these seat alerts, HRig supplies only the exact accepted seat name as the native title and requests `silent: true`. It supplies no body, subtitle, generated suffix, host, rig, path, prompt, terminal text, activity, error detail or other metadata. Accepted names are nonblank, at most 150 Unicode code points and contain no control, format or line/paragraph separator characters; accepted text is preserved exactly. Invalid names, conflicting duplicate representations, malformed requests, extra fields or extra arguments are refused without substituting private content. The OS may add application identity, truncate the title or suppress delivery according to support, permissions and notification settings. The seat name itself will be visible if the OS displays the notification; choose names accordingly.

Only later observed needs-input transitions in verified, healthy inventory for the current connection are eligible, deduplicated by seat identity. Enable/re-enable, owner replacement/repointing and gap recovery begin silently. Disabled, missing, foreign, unverified or stale/unhealthy snapshots cannot emit; explicit errors and quiet poll failures disarm state. The next healthy current-owner snapshot silently seeds the baseline, so needs-input arising during failure or at recovery may go unannounced. Failed/error status is not a needs-input event. The path retains only current owner/identity membership in memory, not notification content or a notification history. It adds no click action, input, lifecycle control, polling, upload, queued catch-up or delivery retry.

Observation uses the existing inventory cadence on the current connection. Hidden-window inventory polling is suppressed; this feature does not provide continuous background or fleet monitoring. Desktop/native permission, actual display and accessibility, checkbox keyboard/AT, layout/themes and real restart behavior remain unobserved. Status flapping/re-entry, OS suppression and native notification object lifetime/garbage collection do not have an observed delivery guarantee.

Separate terminal bell and quiet alerts require their own opt-ins (both default `false`) as well as `notifications.desktop`. They retain their existing generic notification endpoint and options contract, using seat/shell-label and host metadata without terminal text. The exact seat-name-only boundary for needs-input alerts does not describe all HRig notifications. See [settings](SETTINGS.md#desktop-needs-input-notifications) and [navigation](NAVIGATION.md#desktop-needs-input-notifications) for scope and controls.

## Confirmed terminal uploads

Dropping one file on an SSH terminal or choosing Paste image transfers its bytes to that terminal's existing remote connection only after a native confirmation shows the host, temporary destination, file name and size. Dropped files are capped at 10 MiB; clipboard images use their own 10 MiB cap and PNG conversion. The path is inserted without Enter. Cancel sends no file. Temporary files remain on the host until removed by the user (or the existing opportunistic image cleanup); do not put secrets in an upload unless you intend them to reach that host. See [terminal file drop](docs/terminal-file-drop.md) and [image paste](docs/terminal-image-paste.md).

## Optional terminal logs

Continuous terminal recording is off by default. Start log requires choosing a local desktop file and visibly indicates when recording is active. Output from local or remote terminals is appended there until stopped or disconnected, with control sequences stripped and bounded file/queue sizes. Logs may contain sensitive output, including text a program later erases; stripping terminal controls does not redact secrets. HRig does not upload or automatically delete these user-chosen files. Separately, Save terminal log asks before saving the current terminal's retained scrollback to a local file chosen by the user; it is never added to the diagnostics bundle or uploaded. Terminal bookmarks remain in memory and expire when their retained output is discarded.

## Snippet export and import

Saved terminal snippets are stored locally in the workspace settings. Export shows them as JSON text with only each snippet's name and text, exactly as saved. Copy JSON writes that text to the system clipboard, and Save to file writes it only to the path you choose in the native save dialog. Snippet text can contain anything you typed, including secrets, so keep passwords and tokens out of snippets. Import reads text you paste or a JSON file you choose, checks it, shows what it would add and adds nothing until you confirm; the file is read into the app for that check and is not uploaded. Import never sends anything to a terminal.
