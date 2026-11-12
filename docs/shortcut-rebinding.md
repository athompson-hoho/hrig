# Rebinding shortcuts

Status: implemented for high-use app actions. The Keyboard shortcuts sheet (press ?) lists the current keys and lets you edit or reset each supported action. Changes are stored in `shortcuts.overrides`; no change is made until Save succeeds.

## Supported actions

The sheet can rebind the command center, Quick Open, sidebar toggle, new terminal, close selected panel, next and previous panel, maximize panel, focus terminal/editor/task queue, reopen closed panel, focus mode, and terminal search. Reset returns one action to its default; Reset all removes every override.

## Chords and conflicts

Type one main-modifier chord with an optional Shift and one supported key: a letter, number, Tab, Enter, Escape, Space, punctuation key, or F1-F12. Ctrl, Cmd, and Mod mean the platform's main modifier. `Control` always means the physical Control key, including on macOS; this keeps Ctrl+Tab and Ctrl+Shift+Tab as panel navigation there. Alt/Option, Windows/Meta, bare keys, malformed chords, and unsupported combinations are refused.

The pure checks live in `src/shortcut-overrides.ts`. The app refuses collisions with fixed app, terminal, or editor shortcuts, another effective shortcut, and known operating-system shortcuts. Terminal conflicts are checked with the real `classifyTerminalKey`; the editor's Shift-letter list is checked against the installed Monaco package by tests. Invalid, unknown, repeated, or clashing saved entries are ignored and explained in the sheet. A moved shortcut's old chord is released to the terminal or editor.

## Scope and limits

Overrides use one text setting across platforms, with the platform's primary modifier displayed as Cmd or Ctrl. This is a typed text field, not a key recorder. The app does not rebind terminal-owned controls, editor-owned controls, or fixed navigation such as the panel finder, settings, and project chooser. Layout and input-method behavior still needs human checks on supported platforms; see `HUMAN-UAT.md`.
