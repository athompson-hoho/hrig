# Opt-in spellcheck for Markdown (E15): not implemented, decision needed

Status: **skipped with reason.** The backlog item is implementable only after one choice that is
not mine to make silently.

## Why it is not a small change
- **Monaco has no spellchecker.** It renders text into its own elements and uses a hidden
  textarea for input, so the browser's native spellcheck underline never appears in the editor.
- **Electron's built-in spellchecker (Chromium/Hunspell) needs dictionaries.** On Windows and
  Linux Electron downloads them from a Google-hosted URL the first time a language is used. That
  is an outbound network request from a desktop app whose PRIVACY.md currently promises no
  surprise network use, so it cannot be turned on by default or without telling the user.
  (macOS uses the system spellchecker.) Even enabled, it would not underline Monaco text.
- **Bundling a word list** (for example an SCOWL/Hunspell en-US list, roughly 0.5-3 MB) avoids the
  network but needs a licence review, a size decision, and a language story (one language? the
  OS locale?).

## Options for a human to choose
1. **Bundled English word list, in-editor markers (recommended if wanted).** Pure function
   `misspellings(text, dictionary)` skipping code spans, fences, URLs, identifiers
   (camelCase/snake_case/digits) and ALL-CAPS; shown as Monaco marker decorations for `.md`
   files only, with "Add to dictionary" kept locally in settings. Opt-in setting
   `editor.markdownSpellcheck` (default off). No network. Needs: dictionary licence and size sign-off.
2. **Electron native spellcheck in a plain-text "Markdown notes" textarea only.** Cheaper, but a
   different editing surface and the dictionary download above.
3. **Do nothing.** Terminals and agents are the main product; prose checking is a nice-to-have.

## Safe boundaries for any option
Opt-in; Markdown files only; no network; no text leaves the machine; never auto-corrects (markers
only); skips fenced code and URLs; bounded to the first 200,000 characters (same as Preview).

## What is needed to proceed
A yes/no on option 1 and approval of the word-list licence and size.
