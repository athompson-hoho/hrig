# Account-aware team recommendations

The status bar's Accounts control and Rig designer show authentication availability for the selected connection. From 0.12.0, status-bar checks run when the panel is opened, avoiding unnecessary authentication probes during workspace startup. Refresh explicitly after signing in or changing accounts. Checks do not run model prompts or consume assessment tokens.

Automatic runtime selection uses runtimes whose documented CLI authentication check succeeds on that host. A team uses both Codex and Claude Code when both are authenticated, or the one confirmed runtime when only one is available. Specific runtime choices remain manual overrides. Existing manually protected seats are retained. Authentication does not establish available quota, model access, concurrent-seat capacity or session context remaining.

Orca integration uses `orca account list --json` (or `orca-ide` on Linux). HRig whitelists account ID, runtime, display label and host/WSL scope. It does not read private credential stores, copy tokens or persist the account list in workspace state. Managed profiles are informational: being listed does not prove OpenRig can launch under that profile. Windows accounts are not treated as WSL/SSH accounts. Remote CLI checks run on the selected host; the Orca list describes the computer running HRig.

This first integration does not switch accounts, bind an Orca-managed account to a seat, or show per-session token context or rate-limit estimates. New seats use the selected host's existing runtime sign-in. Existing sessions retain their authentication context. Account switching and seat-level account binding require a supported OpenRig launch integration before they can be offered reliably.

Codex authentication check: https://learn.chatgpt.com/docs/auth
Claude Code authentication check: https://code.claude.com/docs/en/cli-reference

Validation: TypeScript compilation; metadata whitelisting and local/WSL/SSH scope tests; read-only runtime status checks against local Windows and Ubuntu WSL. No visible desktop test windows were launched.
