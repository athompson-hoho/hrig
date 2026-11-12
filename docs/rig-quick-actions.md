# Rig quick actions (R25): safe version

A "Rig actions" button (⋯) beside each rig in the sidebar opens a small menu with two entries:

- **View status (ps)** opens the OpenRig control center on `ps`.
- **List snapshots** opens it on `snapshot list` with this rig's id filled in.

**Choosing an entry only navigates.** It opens (or re-targets) the existing control center panel on that
command. Nothing runs until the user presses **Review action**, reads the exact `rig ...` command and
working folder, types the confirmation and presses **Run reviewed action**: the same reviewed flow as
every other control-center command. The menu has no run path of its own: no `window.hrig` call, no
`prepare` or `execute`, nothing typed into a terminal.

Boundaries:
- Exactly two read-only commands, fixed in `src/rig-quick-actions.ts` (frozen data, checked against the
  shipped command index by a test). No start, stop, archive, restore, delete or create. Creating a snapshot
  stays an ordinary control-center step.
- The rig id is prefilled only when it is plain text; an id containing control, bidi or zero-width
  characters (or over 200 characters) is not prefilled, never "cleaned".
- A request older than 10 seconds is ignored, so restoring a saved layout never re-navigates.
- Only rigs of the active connection are listed, and the menu is disabled while the inventory is in error.

Not done: lifecycle actions, running `ps` inline in the sidebar, a keyboard shortcut.
