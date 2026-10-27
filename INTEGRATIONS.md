# Task boards and integrations

Open **Tools → Project boards and integrations**, or search **Task boards and integrations** in the command center. Each panel belongs to its connection and project folder. Source configuration, local tasks and OpenRig assignment links persist locally; no source is automatically synchronized to another system.

## Local project boards

Create, edit and explicitly delete tasks, and move them between Todo, Doing and Done through a reviewed status change. Local tasks do not require a remote account. Clearing saved message/editor drafts preserves board records.

## GitHub Issues

Install GitHub CLI on the machine running HRig and run `gh auth login`. HRig uses that login through fixed `gh` arguments and stdin JSON; it does not copy the GitHub token into preferences. Enter `owner/repository`, then **Load / refresh board**. View descriptions, source links and open/closed columns. Creating an issue or changing its state requires a confirmation in the item dialog. GitHub.com is supported; Enterprise hosts are outside this release.

## GitHub Projects

Enter the owner login/organization and project number from the project URL. Project cards are grouped by their actual status field. This release reads Projects boards; it does not edit arbitrary project fields, reorder cards or add issues to projects. Use GitHub Issues for repository issue creation and open/closed changes. Projects permission may require `gh auth refresh -s read:project`. HRig shows CLI/API errors rather than presenting an inaccessible board as empty.

## Linear

Select Linear and expand **Linear connection**. Enter a personal API key and choose **Verify and connect Linear**. The key is checked against the viewer endpoint and stored using Electron `safeStorage` (Windows DPAPI, macOS Keychain or an encrypted Linux desktop keyring) in `linear-key.bin` in user data. HRig refuses plaintext fallback, including Linux basic_text; enable the desktop keyring before connecting. Keys are not returned to the renderer, written into workspace JSON, or included in draft/preferences exports. Use a key with only the workspace/team permissions you need. This release uses personal keys; OAuth sign-in is a follow-up.

Load the board to discover teams/projects. Choose filters and refresh. Select a team before creating an issue; optionally choose a project. Workflow status choices come from the selected issue's team. Issue creation and status updates require confirmation. Disconnect explicitly removes the locally stored key. Only `https://api.linear.app/graphql` receives the credential.

## OpenRig assignments

Open an item, choose a fresh available seat, review the assignment, then confirm. HRig creates an OpenRig task with the item's title, description and source URL and records the returned task identity locally. It does not start an agent or change the external issue's status. The same item/source is protected against duplicate assignment from this board after success. This is an explicit import/link, not bidirectional status synchronization. Source content is treated as task text, never executed as instructions by HRig itself.

If a request fails or times out, inspect the provider or OpenRig queue before retrying; an uncertain write is never automatically replayed. Boards load on demand and show partial-result warnings at the 100-item limit. Filter display text locally, or narrow the source/project; pagination across arbitrarily large workspaces is a follow-up. Refresh after changing a remote filter. Source links open only HTTPS GitHub.com/Linear.app URLs when clicked.

## Validation and limits

Provider query/mutation boundaries and real Electron board flows are tested with fixtures. A real authenticated read of HRig's GitHub repository also passed. No live issue was created/updated or live rig messaged for QA. Live Linear workspace writes, private Projects permissions and real cross-host assignments require deployment validation with the user's accounts. API permission/rate-limit failures are surfaced; the app makes no claim of offline remote synchronization.

Implementation references: [GitHub Projects CLI](https://cli.github.com/manual/gh_project_item-list), [GitHub Projects API](https://docs.github.com/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects?tool=cli), [Linear API authentication and errors](https://linear.app/developers/graphql).
