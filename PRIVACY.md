# HRig privacy statement

Updated: 2026-10-27

HRig is a desktop workspace for OpenRig. It does not operate a hosted project-storage service, include advertising, or automatically upload product analytics or crash reports to the maintainer. It stores workspace data locally and communicates with hosts, services and agents selected by the operator.

## Local information

Settings, selected connection details, workspace layouts, per-file review checks, drafts/recovery copies, integration configuration, mobile pairing records and related local state are stored on the desktop computer. Drafts can contain unsaved source code and review/message text. Credential storage uses Electron's operating-system-backed encryption where the relevant integration supports it; CLI tools also maintain their own authentication stores. HRig's Windows uninstaller preserves application data, so uninstalling is not a credential or draft erasure operation. Use the applicable disconnect, device-revocation and saved-draft controls to remove those records.

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

## Optional terminal logs

Continuous terminal recording is off by default. Start log requires choosing a local desktop file and visibly indicates when recording is active. Output from local or remote terminals is appended there until stopped or disconnected, with control sequences stripped and bounded file/queue sizes. Logs may contain sensitive output, including text a program later erases; stripping terminal controls does not redact secrets. HRig does not upload or automatically delete these user-chosen files. Terminal bookmarks remain in memory and expire when their retained output is discarded.

## Snippet export and import

Saved terminal snippets are stored locally in the workspace settings. Export shows them as JSON text with only each snippet's name and text, exactly as saved; HRig does not write that text to a file, copy it or send it anywhere, so where it goes is up to you. Snippet text can contain anything you typed, including secrets, so keep passwords and tokens out of snippets. Import reads only text you paste into the dialog, checks it, shows what it would add and adds nothing until you confirm; it never sends anything to a terminal.
