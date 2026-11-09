# Broadcasting input to several terminals

Design note only; not implemented. HRig sends nothing to more than one terminal at a time, and this note changes no code, adds no setting and has no test.

## Goal

Let a person send the same line to several terminals at once, for example the same command to a few shells, without opening each one.

## Current behavior

- Nothing is auto-sent into a seat or a shell. Every route that puts text into a terminal is aimed at one terminal and one person's decision.
- The terminal command channel is `sendTerminalCommand(id, command, text)` in `src/terminal-commands.ts`. It dispatches a `hrig:terminal-command` event for one terminal id; the terminal panel (`src/TerminalPanel.tsx`) answers only the event that carries its own id. Insert pastes the text with `term.paste(text)` and presses no key; run does the same and then writes a carriage return to the PTY.
- `snippetError` accepts one printable line only: empty text, more than 10,000 characters, control characters, line breaks and invisible formatting characters are all refused, and the panel refuses when the terminal is not connected ("Nothing was sent."). A multi-line or control text can therefore not go through this channel, and a broadcast design must keep that.
- Run is reviewed. In `src/TerminalSnippets.tsx`, "Review insert and run" shows "Send this exact text followed by Enter to <name> on <connection> (terminal <id>)? Existing input at the cursor will also be submitted." and Enter is sent only by a separate click on "Insert and run". The command center lists its entries per terminal with the host and the terminal id (`src/App.tsx`), and leaves out one-time OpenRig action terminals (the ones that carry a `rigControlToken`).
- Host label and tint (`src/host-tint.ts`, TERMINALS.md) exists because mistaking a production shell for a development one is a real risk. It is a person's own label per saved connection (up to 24 characters, six colors). HRig does not know which host is production.
- Seats have their own channel: `window.hrig.sendMessage(connection, seat, message)` (`rig:send` in `electron/main.cjs`, `sendMessage` in `electron/backend.cjs`) sends a message to a seat, not keystrokes to a terminal. The rig command list in `src/RigControl.tsx` names a `broadcast` command; what it does was not examined for this note.
- Input typed while a terminal is disconnected is dropped, never queued (`onData` in `src/TerminalPanel.tsx`), because after an uncertain disconnect replayed keystrokes could run commands unseen.
- The backlog lists a pod-level broadcast with a recipient list preview (item R20). It is not in this tree, so nothing here relies on how it looks or works.

## Risks

- One keystroke would run in N shells, and some of them may be on a host where that is destructive. Most mistakes are not undoable: a sent line cannot be recalled.
- Live keystroke mirroring is the worst shape: every key, including Ctrl+C, Ctrl+D, Tab completion and paste, lands in each terminal, whatever its state (a password prompt, an editor, a pager, a different directory or shell).
- The terminals may not be the same. Different shells, directories, users, hosts and quoting rules make one line mean different things; a path or a name valid in one is wrong in another.
- Production confusion. The tint helps only where a person set a label, and an untinted connection says nothing.
- Existing input at each cursor is submitted with the new line, as for a single run, but here nobody sees it in all terminals.
- Partial failure. Some terminals accept, some are disconnected or busy or refuse; the person must see which.
- IME composition and paste do not arrive as simple key events, so mirroring them is not reliable. A pasted line is subject to the same limits as a snippet.
- Seats are agents: a line sent to a seat's terminal is a prompt, and the effect of one prompt in several seats at once is not comparable to a shell.
- There is no record afterwards unless one is built.

## Options

1. Live keystroke mirroring (type once, appears in all). Rejected: see the risks above.
2. A reviewed "Send line to selected terminals" dialog, built on the existing channel (recommended).
3. Seats only, through `rig send` and `sendMessage`, with a recipient list. A different surface with different risks, covered by the backlog item above.
4. Do nothing; people use one saved snippet per terminal, which is what exists.

## Recommendation

If this is approved, option 2, and not before the rules below are agreed:

- Explicit selection, never "all". A dialog lists every recipient with its terminal id, connection and host, and its tint label if one is set, and shows the exact text once.
- One printable line, by the same `snippetError` rule, and no Enter by default. Insert only; running is a second step with its own review, as for a single terminal.
- A confirmation the person must type, such as the number of recipients, not just a click.
- A recipient limit (for example 8) and an exclusion of terminals that are disconnected, still connecting or action terminals.
- Terminals on different connections, or any carrying a tint label, need their own extra confirmation naming them. Mixed local and remote recipients are refused or called out.
- Each terminal gets its own result ("inserted", "not connected", "refused") shown in the dialog. A failure never stops the rest silently and never retries.
- A record of what was sent and to whom is kept only if the owner wants one: the text may hold a secret, so a record should hold counts and targets, not the text, unless approved otherwise.
- Existing input at the cursor is not cleared; the dialog says so.
- It is an explicit command, not a setting, and there is no shortcut.

Open questions for the owner: whether the run step should exist at all for several terminals, whether production-labelled connections are excluded outright, what the record holds, and whether seats belong in this dialog or only in the rig broadcast.

## Approval gate

A person must approve this before anything is built: that broadcasting exists at all, the dialog and confirmation rules, the recipient limit, whether running is allowed, and the record. The project's rule that nothing is sent without a review applies in full. Until then no code, no setting and no shortcut is added.

## Tests an implementation must add

- The dialog never sends on open, on selecting recipients or on pressing Enter in a field; only its explicit button does, and Escape, close and click-outside send nothing.
- The text goes through `snippetError`: multi-line, control, invisible and over-long text is refused with nothing sent to any terminal.
- No Enter is sent unless a separate run step is confirmed; the run step shows the exact text and every recipient.
- The typed confirmation must match the recipient count exactly.
- Disconnected, connecting, action terminals and the recipient limit are enforced in the code, not only hidden in the list.
- A tinted or other-connection recipient requires its extra confirmation; a recipient removed from the list never receives the text.
- Per-terminal results are reported, and one refusal does not hide the others.
- A terminal id that no longer exists receives nothing.
- A real-display check with real SSH and local shells, a password prompt and a full-screen program in a recipient.
