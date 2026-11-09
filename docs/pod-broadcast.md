# Pod broadcast

Design note only; not implemented. HRig sends a message to one seat at a time, and this note adds no dialog, no setting, no shortcut and sends nothing. The one code artifact that goes with it, `src/pod-broadcast.ts`, is a pure helper that nothing imports. It is backlog item R20.

## Goal

Let a person send one message to several seats of a pod at once, after a preview that lists exactly who would receive it, without opening each seat's message panel.

## Current behavior

- The model. `Seat` in `src/types.ts` has `id`, `rigId`, `rigName`, `name` (the logical id), `pod`, `runtime`, `model`, `session`, `status`, `activity`, `error` and `workCount`. `normalizeInventory` in `electron/core.cjs` builds it from `rig ps --json` and `rig ps --nodes --all-rigs --json` on the selected connection: `id` is the rig id, a colon and the logical id; `pod` is `podNamespace`, else `podId`, else empty; `session` is the canonical tmux session name or null; `status` is attention, working, idle or running while a session runs, and otherwise the raw session status (stopped, exited, failed, unknown and so on). The list is a snapshot refreshed every few seconds, so it can be stale when a person acts on it. The sidebar lists sessions flat; a pod only shows as a name prefix in the rig topology view (`src/WorkbenchPanels.tsx`). A pod name belongs to its rig: the same name can exist in several rigs.
- Sending to a seat has one path: `window.hrig.sendMessage(connection, "name@rig", text)`, then `rig:send` in `electron/main.cjs`, then `sendMessage` in `electron/backend.cjs`, then `rig send <seat> <text>` through `runRig` in `electron/features.cjs`, which gives each call 25 seconds. The backend only checks that the seat is a non-empty string and the text is not blank and under 50,000 characters. It is strictly one recipient per call and passes no options. Three places use it, each for one seat: the message panel (`RecipientMessage` in `src/RigPanels.tsx`), "Send notes to selected seat" in `src/ReviewWorkspace.tsx` and the handoff request in `src/TaskBoard.tsx`.
- The single-seat flow is careful. The draft is saved per seat; the status "sending" is stored before the call; an error or a timeout leaves "Delivery is uncertain" with the draft kept, the button says "Send again deliberately", and HRig never retries by itself; success says "Accepted by OpenRig" and that this does not confirm the agent read it. Nothing models several recipients with one draft and one result each.
- `rig send` presses Enter for you. Read from `rig send --help` of rig 0.7.7 on the planning machine (HRig's audited command index is 0.6.14, so this was not checked against that version): the two-step send (paste the text, wait, submit Enter) is automatic; the text goes inside a From and To envelope; a terminal seat (runtime `terminal`) gets the exact text without the envelope because its shell would run the envelope lines, so a message to it is a command; a send is refused only on positive evidence that the target is at an interactive prompt, and a busy pane is sent to with an advisory; a send can wait up to 60 seconds, and "a timeout or missing pane text does not prove the message was not delivered". HRig's 25 second limit is shorter, so "delivery uncertain" is an ordinary outcome.
- The CLI has fan-out of its own, selected by name: `rig send --to a,b`, `--pod <name>` and `--rig <name>`, and `rig broadcast`, with per-recipient results and an "N/M delivered" summary. `rig broadcast --pod` matches pod names across all rigs unless `--rig` is set, and without `--rig` or `--pod` it "broadcasts to ALL running tmux sessions plus any attached external_cli nodes across all rigs". HRig's command index (`src/openrig-command-index.json`) lists `broadcast` with six options and the control center has a guided form for it (`src/RigControl.tsx`). Its review shows the exact command and asks the person to type the fixed words `rig broadcast`, which confirms the command, not who receives it, and the review expires after two minutes. That form is today's manual multi-seat route, next to one `RecipientMessage` per seat.
- The terminal route is different. `sendTerminalCommand(id, "insert", text)` in `src/terminal-commands.ts` pastes text into one open terminal with `term.paste` and presses no key; "run" is a separate, reviewed step. `snippetError` refuses anything but one printable line, and the terminal panel refuses when it is not connected. Multi-line text pasted into a terminal can run at once without bracketed paste (`needsConfirmation` in `src/terminal-paste.ts` and the setting `terminal.confirmMultilinePaste` exist for that reason), which is why the insert route keeps to one line. A seat terminal attaches to the seat's tmux session and never creates or restarts it. The note `docs/terminal-broadcast-input.md` covers terminals and says the seat-only variant is this backlog item.

## Risks

- A typo, a wrong pod or a wrong text reaches many seats at once and cannot be recalled. A message to an agent starts work, so a wrong broadcast is not only noise.
- Wrong recipients. A pod name is not unique across rigs, so choosing "the pod" by name (`--pod`, `rig broadcast`) is a different set from the list a person looked at. An empty or lost selection must never turn into "everyone": without a target the CLI broadcast reaches every running session.
- A terminal seat is a shell. `rig send` gives it the exact text and Enter, so the broadcast text would run as a command. A pod can contain one.
- A person's own seat, and stopped, exited or failed seats, are not agents waiting for work. How OpenRig lists a person in the inventory was not verified; `src/pod-broadcast.ts` uses the same conservative guess as the needs-input sound (a name or session starting with human, a session ending in `@external`, or runtime human) and leaves a doubtful seat out.
- Prompt injection fans out. If the text came from untrusted material (a terminal selection, a queue item, a task body), every recipient reads the same hostile instruction, and agents that can act do so in parallel. The text is also a prompt that may hold a secret: it lands in several transcripts and, while `rig send` runs, in its arguments on the host (not measured here).
- Option injection. HRig passes `name@rig` and the text as plain arguments with no `--` before them, and `rig send` has options such as `--rig`, `--to` and `--dangerously-interact`. A seat, rig or text that starts with a dash might be read as an option. Not tested; the helper refuses names that start with a dash, contain a space, an at sign or a comma, or had to be cleaned or cut to be shown, because the preview must show exactly the address that would be used. An at sign matters because the CLI reads `agent@rig@host` as a target on another registered host.
- Hidden characters. Zero-width and bidirectional characters in a text or a name make the preview differ from what is sent. The helper refuses them in a text, which also refuses an emoji sequence joined with a zero-width joiner.
- Seats on remote hosts. For an SSH connection every call is its own ssh round trip to the machine that runs the seats, so N calls in turn can take N times 25 seconds, and a host that limits logins turns the tail into partial failures.
- Partial failure. Some recipients accept, some refuse (the CLI's prompt guard), some time out with an uncertain result. A person must see each one, and nothing may retry by itself.
- A stale preview. A seat can stop, fail or start asking a question between the preview and the send. The CLI guard covers an interactive prompt and nothing else.
- tmux copy mode. A seat pane that someone has scrolled into copy mode might not take pasted text the way an idle input box does. Whether `rig send` handles that was not tested here; it needs a real seat.
- Volume. N agents each spend a turn on the message; a long text multiplies that.

## Options

1. Do nothing. Today a person sends one message per seat in the message panel, or fills in the control center's `broadcast` form, whose review shows the exact command.
2. Staged insert. For a chosen set of seats that already have an open, connected HRig terminal, paste the text into each terminal with the existing insert channel and press nothing. The person reads it in each terminal and presses Enter there. Nothing runs by itself. It needs one open terminal per recipient and one printable line (`snippetError`), and a seat with no open terminal cannot be a recipient.
3. One message per recipient through the existing message path: `sendMessage` once per recipient, in turn, never terminal input. This is the route the planning scope named. It reaches seats without an open terminal and multi-line text, but `rig send` submits the message, so no "never run" property is available on it, and a terminal seat is dangerous (the helper leaves it out).
4. One `rig send --to a,b,c` call with an explicit list, through a new backend method and IPC channel. The per-recipient results come from the CLI. It is a new execution path, so it needs its own review. It is never built from `--pod`, `--rig` or `rig broadcast`.
5. Broadcast by name (`--pod`, `--rig`, `rig broadcast`) from a button. Rejected: the recipients are chosen by the CLI at send time, not by the list the person confirmed.
6. Live keystroke mirroring. Rejected, for the reasons in `docs/terminal-broadcast-input.md`.

## Recommendation

Do nothing now. Ship this note and `src/pod-broadcast.ts`, which writes the preview and confirmation rules down and tests them, and build no dialog, setting or shortcut until a person approves.

If it is approved, these rules hold for every route:

- Select a pod from the list of `podGroups` (grouped by rig id and pod, never by pod name alone). Every recipient is ticked by hand and starts unticked: never "all" by default. A seat that cannot be a recipient is shown greyed with its reason.
- The preview is `previewRecipients`: every recipient as name@rig with its runtime and status, every exclusion with its reason (no session, stopped, exited, failed, a person, a terminal seat, an unsafe name, an unknown seat, a repeat, over the cap), the cap of `MAX_RECIPIENTS` (8), mixed rigs called out, and the exact text shown once. The text goes through `validateBroadcastText` (at most `MAX_TEXT_CHARS`, 10,000, with no control or hidden characters; the checked text is the exact text, never trimmed).
- A typed confirmation: the person types the number of recipients (`confirmationPhrase` and `confirmed`, exact match, so "08" and " 8" fail). Not a click, and not a fixed phrase.
- Explicit, off by default behind a setting such as `seats.broadcast`, held at the user level so a project cannot switch it on, and started from a command center entry for the selected pod; no default shortcut.
- Before each recipient, re-read the latest seat list and skip, with a reason, a recipient that is no longer eligible. Pace the sends (one at a time, a short pause between recipients, one broadcast at a time, no second broadcast right after the first) and never retry by itself.
- Each recipient's own result is shown (staged or accepted, refused with the message, uncertain), and a failure never hides the others. Closing the dialog while the sends run is blocked until they end.
- The text is not stored in any history; if a record is wanted it holds counts and targets only. Nothing is sent on open, on ticking, or on pressing Enter in a field; the button is the only trigger.

Delivery is the one open decision, for the person who approves it:

- Prefer option 2, staged insert, with no Enter: it keeps the rule that nothing is submitted for the person, and the cap, the preview and the typed count still apply. Its price is one open terminal per recipient and one line of text.
- Option 3 only if the approver accepts that `rig send` submits the message to every recipient, with the typed count as the gate and the per-recipient results above. Option 4 only if it is reviewed as a new execution path.

## Approval gate

A person must approve this before anything is built: that a broadcast exists at all; the delivery route (staged insert, or a message that submits); the cap of 8; the preview and the typed count; the setting and its place; the exclusion of terminal seats and people; and whether text or only counts are recorded. Until then HRig sends nothing to more than one seat, there is no setting and no shortcut, `src/pod-broadcast.ts` stays unused, and the control center's `broadcast` form stays as it is. Whether that form should carry an extra warning is a separate question for the owner.

## Tests an implementation must add

- `tests/pod-broadcast.test.cjs` keeps passing, including the test that no application file imports the helper until the feature is approved and wired.
- With the setting off nothing changes: no entry, no event, no call. Opening the dialog, ticking a seat and pressing Enter in a field send nothing; only the button does; Escape, close and click-outside send nothing.
- The recipient list sent to is exactly the previewed list: a recipient removed after the preview, or a seat that became ineligible, receives nothing; an empty list cannot be confirmed; the typed count must match exactly.
- The code, not only the list, enforces the cap, the exclusions and the text rules; a text that starts with a dash reaches `rig send` as text, not as an option (check against the real CLI, and refuse or guard it if it does not); no call is built from `--pod`, `--rig`, `--to` with a name or `rig broadcast`.
- Per-recipient results: accepted, refused and uncertain are shown separately, one failure does not stop or hide the others, and nothing is retried.
- Staged route: nothing but the insert channel is used, no Enter is written, a seat with no open connected terminal gets nothing, and the text is one printable line.
- Real seats, on a real display: a pod with a terminal seat and a person seat in it, a seat at a permission prompt, a stopped seat, a seat in tmux copy mode, an SSH connection with several recipients, and the time and the results of N sends in turn.
