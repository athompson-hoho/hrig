# Format on save (E12): safe version

Implemented as the safe version of a [D] item; this note records the boundaries.

- **Opt-in** (`editor.formatOnSave`, default off), at user or project scope.
- **Only on an explicit Save** (Ctrl/Cmd+S or the Save button). Never on open, blur, auto-reload or a timer.
- **Built-in formatters only**, through Monaco's `editor.action.formatDocument`, for JSON, CSS/SCSS/Less, HTML, JavaScript and TypeScript. No project formatter binary (prettier, black, gofmt) is run and nothing is executed on the host, so a repository cannot make HRig run code by being opened.
- **Visible**: the formatted text appears in the editor first, the "Formatted on save" notice is shown, and normal undo (Ctrl+Z) restores the unformatted text because the edit is an ordinary editor edit.
- **Bounded**: read-only editors and files over 500,000 characters are skipped; the diff and compare views never format.
- **Fails safe**: if the formatter is unavailable or throws, the file is saved as written with a notice.
- **No double save**: a second Save while formatting is ignored; the existing save guards (revision conflict check, busy flag) are unchanged.

Deliberately not done: running external formatters (needs a trust decision per project), format-on-paste, format selection on save, and per-language overrides. Verifying that Monaco's formatters are bundled and produce the expected output needs a real display.
