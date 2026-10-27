# OpenRig GUI command coverage

Audited installed CLI: 0.6.14 (df1c1517). Read-only discovery invoked only help and version.

88 top-level commands and 365 command paths were successfully parsed, including 311 leaf actions. Help is available through each command's installed-help disclosure; version is an option in the root form.

All paths have a guided form in Tools → OpenRig control center. Positional arguments, optional and variadic values, boolean and inherited options come from installed help. Unsupported paths and flags are rejected on the selected host; the bundled search index is navigation, not execution authority.

Every execution requires an exact, expiring, single-use action review. Interactive and continuous commands use terminal mode. No live mutations, messages, authentication switches or daemon operations were performed by this audit. CLI parsing, GUI flows and fixture execution are tested separately; this is interface coverage, not proof that every OpenRig operation succeeds in every environment.

| Command | Paths including group | GUI representation |
|---|---|---|
| start | 1 | OpenRig control center → start; guided arguments/options, tooltips and installed help |
| daemon | 5 | OpenRig control center → daemon; guided arguments/options, tooltips and installed help |
| status | 1 | OpenRig control center → status; guided arguments/options, tooltips and installed help |
| snapshot | 2 | OpenRig control center → snapshot; guided arguments/options, tooltips and installed help |
| restore | 2 | OpenRig control center → restore; guided arguments/options, tooltips and installed help |
| crash-cart | 1 | OpenRig control center → crash-cart; guided arguments/options, tooltips and installed help |
| gateway | 7 | OpenRig control center → gateway; guided arguments/options, tooltips and installed help |
| parked | 1 | OpenRig control center → parked; guided arguments/options, tooltips and installed help |
| export | 1 | OpenRig control center → export; guided arguments/options, tooltips and installed help |
| import | 1 | OpenRig control center → import; guided arguments/options, tooltips and installed help |
| ui | 2 | OpenRig control center → ui; guided arguments/options, tooltips and installed help |
| tui | 2 | OpenRig control center → tui; guided arguments/options, tooltips and installed help |
| package | 6 | OpenRig control center → package; guided arguments/options, tooltips and installed help |
| bootstrap | 1 | OpenRig control center → bootstrap; guided arguments/options, tooltips and installed help |
| requirements | 1 | OpenRig control center → requirements; guided arguments/options, tooltips and installed help |
| discover | 1 | OpenRig control center → discover; guided arguments/options, tooltips and installed help |
| attach | 1 | OpenRig control center → attach; guided arguments/options, tooltips and installed help |
| bind | 1 | OpenRig control center → bind; guided arguments/options, tooltips and installed help |
| adopt | 1 | OpenRig control center → adopt; guided arguments/options, tooltips and installed help |
| bundle | 7 | OpenRig control center → bundle; guided arguments/options, tooltips and installed help |
| up | 1 | OpenRig control center → up; guided arguments/options, tooltips and installed help |
| down | 1 | OpenRig control center → down; guided arguments/options, tooltips and installed help |
| archive | 1 | OpenRig control center → archive; guided arguments/options, tooltips and installed help |
| unarchive | 1 | OpenRig control center → unarchive; guided arguments/options, tooltips and installed help |
| host | 7 | OpenRig control center → host; guided arguments/options, tooltips and installed help |
| ps | 1 | OpenRig control center → ps; guided arguments/options, tooltips and installed help |
| roster | 4 | OpenRig control center → roster; guided arguments/options, tooltips and installed help |
| mcp | 2 | OpenRig control center → mcp; guided arguments/options, tooltips and installed help |
| agent | 2 | OpenRig control center → agent; guided arguments/options, tooltips and installed help |
| spec | 5 | OpenRig control center → spec; guided arguments/options, tooltips and installed help |
| transcript | 1 | OpenRig control center → transcript; guided arguments/options, tooltips and installed help |
| send | 1 | OpenRig control center → send; guided arguments/options, tooltips and installed help |
| stream | 6 | OpenRig control center → stream; guided arguments/options, tooltips and installed help |
| queue | 22 | OpenRig control center → queue; guided arguments/options, tooltips and installed help |
| slack | 13 | OpenRig control center → slack; guided arguments/options, tooltips and installed help |
| project | 18 | OpenRig control center → project; guided arguments/options, tooltips and installed help |
| view | 4 | OpenRig control center → view; guided arguments/options, tooltips and installed help |
| terminal | 4 | OpenRig control center → terminal; guided arguments/options, tooltips and installed help |
| watchdog | 6 | OpenRig control center → watchdog; guided arguments/options, tooltips and installed help |
| workflow | 20 | OpenRig control center → workflow; guided arguments/options, tooltips and installed help |
| capture | 1 | OpenRig control center → capture; guided arguments/options, tooltips and installed help |
| broadcast | 1 | OpenRig control center → broadcast; guided arguments/options, tooltips and installed help |
| walk | 1 | OpenRig control center → walk; guided arguments/options, tooltips and installed help |
| ask | 1 | OpenRig control center → ask; guided arguments/options, tooltips and installed help |
| chatroom | 7 | OpenRig control center → chatroom; guided arguments/options, tooltips and installed help |
| specs | 8 | OpenRig control center → specs; guided arguments/options, tooltips and installed help |
| context | 16 | OpenRig control center → context; guided arguments/options, tooltips and installed help |
| plugin | 5 | OpenRig control center → plugin; guided arguments/options, tooltips and installed help |
| skill | 3 | OpenRig control center → skill; guided arguments/options, tooltips and installed help |
| agent-image | 10 | OpenRig control center → agent-image; guided arguments/options, tooltips and installed help |
| community-harness | 2 | OpenRig control center → community-harness; guided arguments/options, tooltips and installed help |
| fork | 1 | OpenRig control center → fork; guided arguments/options, tooltips and installed help |
| workspace | 3 | OpenRig control center → workspace; guided arguments/options, tooltips and installed help |
| mode | 7 | OpenRig control center → mode; guided arguments/options, tooltips and installed help |
| policy | 10 | OpenRig control center → policy; guided arguments/options, tooltips and installed help |
| whoami | 1 | OpenRig control center → whoami; guided arguments/options, tooltips and installed help |
| config | 5 | OpenRig control center → config; guided arguments/options, tooltips and installed help |
| file | 2 | OpenRig control center → file; guided arguments/options, tooltips and installed help |
| preflight | 1 | OpenRig control center → preflight; guided arguments/options, tooltips and installed help |
| auth | 11 | OpenRig control center → auth; guided arguments/options, tooltips and installed help |
| provider | 10 | OpenRig control center → provider; guided arguments/options, tooltips and installed help |
| usage | 4 | OpenRig control center → usage; guided arguments/options, tooltips and installed help |
| telemetry | 4 | OpenRig control center → telemetry; guided arguments/options, tooltips and installed help |
| health | 10 | OpenRig control center → health; guided arguments/options, tooltips and installed help |
| doctor | 1 | OpenRig control center → doctor; guided arguments/options, tooltips and installed help |
| expand | 1 | OpenRig control center → expand; guided arguments/options, tooltips and installed help |
| add | 1 | OpenRig control center → add; guided arguments/options, tooltips and installed help |
| create | 1 | OpenRig control center → create; guided arguments/options, tooltips and installed help |
| grow | 1 | OpenRig control center → grow; guided arguments/options, tooltips and installed help |
| reconcile-session | 1 | OpenRig control center → reconcile-session; guided arguments/options, tooltips and installed help |
| env | 4 | OpenRig control center → env; guided arguments/options, tooltips and installed help |
| unclaim | 1 | OpenRig control center → unclaim; guided arguments/options, tooltips and installed help |
| release | 1 | OpenRig control center → release; guided arguments/options, tooltips and installed help |
| launch | 1 | OpenRig control center → launch; guided arguments/options, tooltips and installed help |
| remove | 1 | OpenRig control center → remove; guided arguments/options, tooltips and installed help |
| shrink | 1 | OpenRig control center → shrink; guided arguments/options, tooltips and installed help |
| destroy | 1 | OpenRig control center → destroy; guided arguments/options, tooltips and installed help |
| setup | 1 | OpenRig control center → setup; guided arguments/options, tooltips and installed help |
| restore-check | 1 | OpenRig control center → restore-check; guided arguments/options, tooltips and installed help |
| restore-packet | 4 | OpenRig control center → restore-packet; guided arguments/options, tooltips and installed help |
| compact-plan | 1 | OpenRig control center → compact-plan; guided arguments/options, tooltips and installed help |
| compact | 1 | OpenRig control center → compact; guided arguments/options, tooltips and installed help |
| heartbeat | 1 | OpenRig control center → heartbeat; guided arguments/options, tooltips and installed help |
| seat | 19 | OpenRig control center → seat; guided arguments/options, tooltips and installed help |
| handover | 1 | OpenRig control center → handover; guided arguments/options, tooltips and installed help |
| startup-proof | 2 | OpenRig control center → startup-proof; guided arguments/options, tooltips and installed help |
| scope | 25 | OpenRig control center → scope; guided arguments/options, tooltips and installed help |
| proof | 4 | OpenRig control center → proof; guided arguments/options, tooltips and installed help |

Regenerate with `node scripts/audit-rig-control.cjs` after upgrading OpenRig. Actual host help is loaded before preparing an action.
