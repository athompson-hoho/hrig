# Account-aware team recommendations

The status bar's Accounts control and Rig designer show authentication availability for the selected connection. From 0.12.0, status-bar checks run when the panel is opened, avoiding unnecessary authentication probes during workspace startup. Refresh explicitly after signing in or changing accounts. Checks do not run model prompts or consume assessment tokens.

Automatic runtime selection uses runtimes whose documented CLI authentication check succeeds on that host. A team uses both Codex and Claude Code when both are authenticated, or the one confirmed runtime when only one is available. Specific runtime choices remain manual overrides. Existing manually protected seats are retained. Authentication does not establish available quota, model access, concurrent-seat capacity or session context remaining.

Orca integration uses `orca account list --json` (or `orca-ide` on Linux). HRig whitelists account ID, runtime, display label and host/WSL scope. It does not read private credential stores, copy tokens or persist the account list in workspace state. Managed profiles are informational: being listed does not prove OpenRig can launch under that profile. Windows accounts are not treated as WSL/SSH accounts. Remote CLI checks run on the selected host; the Orca list describes the computer running HRig.

This first integration does not switch accounts, bind an Orca-managed account to a seat, or show per-session token context or rate-limit estimates. New seats use the selected host's existing runtime sign-in. Existing sessions retain their authentication context. Account switching and seat-level account binding require a supported OpenRig launch integration before they can be offered reliably.

Codex authentication check: https://learn.chatgpt.com/docs/auth
Claude Code authentication check: https://code.claude.com/docs/en/cli-reference

Validation: TypeScript compilation; metadata whitelisting and local/WSL/SSH scope tests; read-only runtime status checks against local Windows and Ubuntu WSL. No visible desktop test windows were launched.

## Plan-aware recommendations (0.13.0)

On demand, Codex account metadata is read through app-server initialize and account/read with refreshToken:false; no model turn or login is started. Claude uses the subscription label exposed by auth status. Only known plan labels are returned; credentials and raw account responses are not stored or included in assessment briefs. Unknown or unavailable labels stay unknown. This checks the selected host CLI identity, not an arbitrary Orca-managed profile or per-seat override.

The rig wizard exposes project-scoped Claude/Codex monthly plan amounts in USD, also available in Settings. The initial $200/$100 amounts reflect the operator-provided values, not detected invoice prices. Set 0 for unknown and adjust when changing accounts. When both known amounts are provided, Auto uses weighted allocation and gives the lead role to the higher amount, with an independent second runtime when available. $200 Claude / $100 Codex yields Claude + Codex for a pair and Claude + Codex + Claude + Claude for four seats. Authentication remains required for automatic selection. If a plan amount is unknown, allocation falls back to the runtime preference and balanced rotation. Manual runtime selections and protected seats remain authoritative. AI assessment receives these operator-declared amounts and provider plan labels as evidence; subscription cost is not a claim about available quota, concurrency, remaining context or model capability.
