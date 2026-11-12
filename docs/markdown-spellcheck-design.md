# Spellcheck (E15): native text boxes only, not the code editor

Status: **safe version delivered; in-editor Markdown spellcheck is not possible with Electron's checker.**
The human chose Electron's built-in spellchecker (no new dependency, no bundled word list).

## What was checked
- **Monaco cannot use it.** Monaco draws text in its own elements and takes input through a hidden
  textarea / edit context that it marks `spellcheck="false"` itself (see
  `textAreaEditContext.js` and `nativeEditContext.js`). Electron's checker only underlines text in
  native editable elements, so it never appears in the code editor, in Markdown files either.
- **Terminals** (xterm canvas) are not editable text either.
- **Network.** On Windows and Linux Electron downloads a language dictionary (`.bdic`, a word list,
  never your text) from the Chromium CDN when the checker has a language. macOS uses the OS checker.
  HRig starts with the checker **off and no language set**, so no dictionary is requested until the
  user opts in. This is stated in the setting text, `SETTINGS.md` and `PRIVACY.md`.

## What was built
- Setting `workspace.nativeSpellcheck` (default off): "Spellcheck HRig text boxes".
- `electron/spellcheck.cjs`: `applySpellcheck(session, enabled, {platform, locale})` (strict boolean;
  off clears languages; on picks one language from the app locale, else its base language, else en-US,
  else stays off), and IPC `spellcheck:set` (trusted window, exactly one boolean).
- The main window now has `spellcheck: true` in its web preferences, but the session is switched off
  before the window exists, so nothing changes until the setting is turned on.
- Affects only HRig's own native text boxes (task drafts, message composers, filters, settings fields
  that do not opt out themselves).

## Not done, by design
No in-editor markers and no bundled dictionary. If prose checking inside Markdown files is wanted
later, option 1 of the earlier note still applies: a bundled word list (licence and size sign-off)
with Monaco marker decorations for `.md` only.
