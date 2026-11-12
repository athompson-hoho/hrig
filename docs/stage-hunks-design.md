# Design note: stage / unstage hunks (E13)

Status: **design note only. Nothing is implemented.** Staging changes the user's git index,
which is shared state that other tools (a terminal `git commit`, an agent in a seat) read
immediately. It needs explicit approval before any code is written.

## What exists today
- The editor's diff view is read-only against `HEAD`: `git diff --no-ext-diff HEAD -- <path>`
  (`electron/core.cjs` `op: "diff"` locally, the `git_run` helper in the remote Python twin).
- Both paths already use `--no-ext-diff`, a contained `path`, and a bounded output.

## Goal
From the diff panel, a user can stage or unstage one hunk (or a selected line range) of one file
without leaving HRig, and can always see what is staged.

## Safe design (proposed)
1. **Explicit, per-hunk, per-click.** A "Stage hunk" / "Unstage hunk" button on each hunk header.
   No bulk "stage everything", no keyboard shortcut, never triggered by save, open or any
   background poll.
2. **Patch from the shown diff, not a re-diff.** HRig builds a one-hunk patch from exactly the diff
   the user is looking at, and sends it to `git apply --cached --check` first, then
   `git apply --cached` (stage) or `git apply --cached --reverse` (unstage). If the file changed
   since the diff was shown (compare the blob id of the working file that was diffed), refuse and
   ask the user to refresh. No guessing.
3. **Scope the argv.** Fixed arguments only (`apply`, `--cached`, optionally `--reverse`,
   `--whitespace=nowarn`), the patch on stdin, never a shell string. The path inside the patch
   must equal the open file's repo-relative path, and must not contain `..` or start with `-`.
4. **Single-use confirmation token** bound to (connection identity, repo root, path, hunk hash,
   index state hash), the same pattern as `seat-message.cjs`. The main process re-derives
   everything; the renderer only supplies the token.
5. **Show the result.** After applying, re-read `git diff --cached -- <path>` and show the staged
   state (a "Staged" badge on the hunk and a file-level count) so the effect is visible, with an
   Undo that applies the inverse patch while the index is still in the state HRig left it.
6. **Never commits, never pushes, never edits the worktree.** Index only.
7. **Refuse when risky**: merge/rebase in progress, conflicted file, binary file, submodule,
   file larger than the diff limit, or a repo whose root cannot be resolved inside the
   connection's workspace root.
8. **Remote parity.** The Python twin must implement the same checks; test local and remote
   outputs for identical results (as done for `inspect`).

## Open questions for a human
- Is index mutation from HRig wanted at all, given terminals are one click away?
- Should line-level staging be in scope, or hunk-level only?
- Should the Undo be offered, or is "unstage" enough?

## Tests to write if approved
Pure logic: hunk extraction, patch rebuild round-trip, path validation, stale-diff detection.
Integration: a temp repo, stage and unstage, verify `git diff --cached` and that the worktree
bytes are unchanged.
