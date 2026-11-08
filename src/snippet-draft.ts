import { snippetError } from "./terminal-commands";

/** The window event a terminal sends to ask the app to open Saved snippets filled in from a selection; it only opens the dialog. */
export const SNIPPET_DRAFT_EVENT = "hrig:terminal-snippet-draft";
/** How many characters of the selection the suggested name keeps. */
export const MAX_DRAFT_NAME = 30;

/** A snippet the person has not saved yet: a short suggested name and the single line of text. */
export interface SnippetDraft {
  name: string;
  text: string;
}
/** Either the draft, or the reason the selection cannot become a snippet. */
export type DraftResult =
  ({ ok: true } & SnippetDraft) | { ok: false; error: string };

/** Turns a terminal selection into a snippet draft: the spaces at both ends are trimmed, a selection that spans lines is refused rather than joined, the rest must pass snippetError, and the name is the first 30 characters of the text. */
export function draftFromSelection(selection: unknown): DraftResult {
  const text = typeof selection === "string" ? selection.trim() : "";
  if (!text) return { ok: false, error: "Select some terminal text first." };
  if (/[\r\n]/.test(text))
    return {
      ok: false,
      error:
        "A snippet is a single line. Select one line (a command that wraps across the screen counts as one). Nothing was saved or sent.",
    };
  const problem = snippetError(text);
  if (problem) return { ok: false, error: problem };
  const chars = Array.from(text);
  const head = chars.slice(0, MAX_DRAFT_NAME).join("").trimEnd();
  return {
    ok: true,
    name: chars.length > MAX_DRAFT_NAME ? head + "..." : head,
    text,
  };
}

/** Announces that a terminal's selection should open the snippets dialog; the event carries the terminal id and the selected text only. */
export function publishSnippetDraft(id: string, text: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SNIPPET_DRAFT_EVENT, { detail: { id, text } }),
  );
}

/** Subscribes to those announcements and returns the unsubscribe; every payload is checked again with draftFromSelection, so a malformed event opens nothing. */
export function onSnippetDraft(
  listener: (id: string, draft: SnippetDraft) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    // Any script can dispatch this event, so only a well-formed payload reaches the app.
    const detail = (event as CustomEvent).detail;
    if (!detail || typeof detail.id !== "string" || !detail.id) return;
    const draft = draftFromSelection(detail.text);
    if (draft.ok) listener(detail.id, { name: draft.name, text: draft.text });
  };
  window.addEventListener(SNIPPET_DRAFT_EVENT, handler);
  return () => window.removeEventListener(SNIPPET_DRAFT_EVENT, handler);
}
