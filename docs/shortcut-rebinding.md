# Rebinding shortcuts

Status: partial by design. Three shortcuts can be rebound; every other shortcut is fixed. A fuller version is a design note only. Not implemented.

## What exists

The Keyboard shortcuts sheet (press ?) lists the keys now in use. Reopen closed panel, Maximize panel and Toggle focus mode can be given other keys, typed in a small field, checked for clashes before anything is saved and put back with Reset. The changes are one text setting, `shortcuts.overrides` (see SETTINGS.md and NAVIGATION.md). The logic is the pure module `src/shortcut-overrides.ts`: chord parsing, the clash and reserved-key checks, the effective catalog, and the routing decision the key handler in `src/App.tsx` asks for before its own classifiers. With nothing saved the module answers no and every key, label and hint is exactly what it was.

## Why only these three

The key handling in this app is not one table. The App handler is a capture-phase listener with early returns; the three rebindable chords each go through a classifier function (`isReopenPanelKey`, `isMaximizePanelKey`, `isFocusModeKey`), so a second decision can sit in front of them without changing them. The other App chords (Ctrl+K, O, B, P, Shift+P, Shift+T and the comma) are inline comparisons that also claim the key in a separate block, so the action and the claim would both have to move. The terminal keys are decided in `src/terminal-keys.ts` and `src/terminal-zoom.ts` by listeners of the terminal itself (xterm's custom key handler and a capture listener on the terminal element), which only see an event the App handler declined, and the editor keys belong to Monaco. Rebinding any of those can take a key from a shell or the editor by accident, so they stay fixed.

## What keeps the three safe

- Only Ctrl or Cmd with Shift and one letter can be chosen, never a bare letter, Ctrl plus a letter alone, an Alt chord or a function key: those are the shell's and the editor's.
- The reserved letters are not typed in by hand. The terminal ones come from running the real `classifyTerminalKey`; the editor ones are checked by a test against the Monaco package that is installed, which fails when an upgrade binds another; the fixed app chords come from the catalog itself.
- The old keys of a moved shortcut are released: the handler steps aside and the terminal receives them again.
- A saved text that is damaged, unknown, repeated or clashing is dropped, never an error, and the sheet lists what was ignored.
- The saved text is a plain text setting under the generic text rules of the settings module. Text that those rules accept but this module cannot use is dropped entry by entry, so a stale or hand-edited value never becomes an error.

## What a fuller version would need

- Move each remaining App chord behind a classifier of its own, with a test that mirrors today's rule, and join its claim and its action so one table drives both. Then add it to the rebindable list.
- Let the terminal key classifier and the zoom action read the same override map. Their listeners are separate from the App handler, so a rebinding there needs the map inside them, plus a test per key that the shell still receives what it received before.
- A per-platform map, because Ctrl and Cmd are one modifier in the saved text today.
- A key recorder: a capture mode that turns every global handler off while a chord is being recorded, with a way out that cannot be rebound.
- Export and import of key maps, and a Monaco keybinding layer for the editor keys.
- A human check on every platform, because layouts and input methods change which letters arrive as keys.
