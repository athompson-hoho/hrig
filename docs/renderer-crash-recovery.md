# Renderer crash recovery

Design note only — this change does not implement renderer crash recovery.

## What current evidence establishes

[Main](../electron/main.cjs) `state:save` queues atomic metadata writes with latest-write suppression; `state:flush` attempts a synchronous final write. [App](../src/App.tsx) debounces saves by 350 ms and attempts that flush in `beforeunload`. Versioned `loadState` and [layout](../src/layout.ts) `restoreModel` restore accepted persisted layout metadata, with fallback for unusable layouts. A crash is not established to run unload or preserve unsent changes.

[Editor buffers](../src/editor-buffers.ts) `buffers`, `persistBuffer` and `getDirtyBuffers` describe renderer memory and dirty recovery-copy persistence. These differ from disk content and the synchronous, bounded [draft store](../electron/drafts.cjs) `draftStore` (100 drafts / 20 MB total, with per-entry limits and possible errors). [EditorPanel](../src/EditorPanel.tsx) already offers explicit Restore/Discard recovery-copy review, tracks divergent disk revisions and saves with a revision. Restoring a copy does not save it to disk. None of these seams promises lossless recovery.

## Unresolved joins

The inspected main `createWindow` and [renderer root](../src/main.tsx) `createRoot` do not join crash/unresponsive events, explicit reload and safe restoration into a demonstrated recovery flow.

Main `terminal:create` retains PTYs, captured connection/seat/session ownership and bounded output. Existing reuse refuses unknown/conflicting seat provenance; future recovery must preserve the exact raw owner identity, PTY and buffer. PTY existence alone does not prove sender lifetime, renderer subscriptions or buffered-output replay after renderer loss. `terminal:close` and `window-all-closed` explicitly kill PTYs; window/app closure differs from renderer-only recovery. Separate popout windows and renderer-owned dock models need joined acceptance; child content and native focus restoration cannot be assumed.

## Future disposable acceptance — proposed, unimplemented and unrun here

All cases below require future fake/disposable evidence before shipping runtime recovery:

- Renderer loss before/after debounced save and flush: identify the last accepted snapshot without overwriting good metadata.
- Dirty drafts, conflicting disk revisions and full/corrupt/failed draft storage: preserve endpoint/path identity, current edits and disk; require explicit review and surface errors.
- Matching/conflicting/missing retained owner/session: preserve PTY/buffer ownership, refuse ambiguity and establish sender/subscription/bounded-output replay behavior.
- Repeated crashes versus unresponsive windows and import rejection: distinct bounded explicit recover/retry/keep-waiting/cancel choices, with no destructive reload loop, automatic lifecycle action or shell/seat input.
- Popout and hidden/activated editor restoration: preserve ownership and X03 exact editor/diff/settings demand activation and retained content. `normalizeOptionalTab` and [DeferredPanel](../src/DeferredPanel.tsx) `DeferredContent` remain constraints; eager mounting is no recovery shortcut.

This is X04's design-note alternative only. Native recovery remains unobserved; independent content review and verification remain required. X03 timing/native/judgment and all earlier gates remain open.
