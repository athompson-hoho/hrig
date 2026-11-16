# Pod broadcast

Implemented: an explicit, reviewed pod message flow. The command center opens the dialog; it sends nothing until a person chooses a pod, selects recipients, reviews the exact text and list, types the recipient count, and chooses Send to pod.

## Goal

Send one message to a selected pod's seats through the existing `window.hrig.sendMessage(connection, "name@rig", text)` path, without opening a separate message panel for every recipient. The pure rules live in `src/pod-broadcast.ts`; `sendMessage` remains the single-seat IPC path.

## Delivered behavior

- The pod picker groups by rig identity and pod, so equal pod labels in different rigs remain separate choices. Recipient checkboxes start clear. People, terminal seats, unsafe addresses, seats without a session, stopped/exited/failed seats, other non-running states, and ambiguous `name@rig` addresses are displayed as excluded with a reason.
- The picker reads at most 500 inventory rows and the selection preview reads at most 100 checked IDs; each bound is shown when exceeded. It never silently broadens either list.
- The recipient preview shows each exact `name@rig` address, runtime and status. It lists selected exclusions and keeps the eight-recipient cap. Every eligible recipient is re-read from inventory immediately before sending; a missing, no-longer-running or identity-changed seat is skipped and reported.
- The exact text appears in the dialog and is limited to 10,000 code points. Approved invisible filler characters are removed before review and sending; ZWJ is preserved for joined emoji. Empty text, controls, other hidden formatting characters and a leading dash are refused. The leading-dash rule prevents the existing `rig send <seat> <text>` CLI argument from being interpreted as an option.
- The person types the exact decimal recipient count (for example `3`) and explicitly chooses Send to pod. Nothing is sent on open, selection, typing or Enter. The sends run sequentially, one message at a time, with no automatic retry. Accepted and uncertain outcomes and pre-send skips are shown per seat. “Accepted by OpenRig” does not mean the recipient read the message.
- The text and results exist only in the open dialog; HRig does not save the broadcast text in drafts or history. Closing the dialog is blocked until the send sequence ends.

## Limits and human checks

`rig send` submits the message to each seat. A seat is an agent, not a shell command target; terminal runtime seats are excluded. A typo or wrong instruction cannot be recalled, and a timeout is uncertain even if the recipient may have received it. HRig never retries automatically.

The inventory is a snapshot. The implementation re-reads it before every send, but a seat can still change after that check. The CLI's interactive prompt guard remains the final protection for that case. The send API accepts `name@rig`, not the hidden rig id; when two inventory rows have the same address both are excluded as ambiguous.

No broadcast text is persisted, but it is passed to the existing `rig send` execution path and may appear in host process arguments or seat transcripts. Do not include secrets. A remote connection incurs one SSH round trip per recipient. A message over the CLI's 25 second execution timeout is reported as uncertain, no further retry occurs, and later recipients are still attempted.

Human UAT is still required on a real display and disposable seats: verify the picker and exact list, terminal/person/stopped exclusions, typed count and cancel/close behavior; send to multiple eligible seats; verify one ineligible seat is skipped, one failure is reported without hiding later results, and no recipient gets a second attempt. Include SSH and tmux copy mode checks. These checks are listed in `HUMAN-UAT.md`; implementation review and automated tests do not approve them.
