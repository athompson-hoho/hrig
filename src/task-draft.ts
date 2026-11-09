/** The window event a terminal sends to ask the app to open the Assign work dialog filled in from a selection; it only opens the dialog and creates nothing. */
export const TASK_DRAFT_EVENT = "hrig:terminal-task-draft";
/** The most characters the suggested subject keeps, the three dots of a cut included. */
export const MAX_SUBJECT = 120;
/** The most characters of the selection the brief keeps. */
export const MAX_BODY = 8000;
/** The most characters of a selection that are read at all, so a huge selection cannot slow the review down. */
export const MAX_READ = 100000;
/** The standing line shown with every prepared draft. */
export const SECRETS_WARNING =
  "Selections can contain secrets: review before creating.";

/** A task the person has not created yet: the suggested subject, the brief, whether the selection was cut, whether it looks like it holds a secret, and the seat whose terminal it came from ("" when there is none). */
export interface TaskDraft {
  subject: string;
  body: string;
  truncated: boolean;
  secretLike: boolean;
  suggested: string;
}
/** Either the draft, or the reason the selection cannot become one. */
export type TaskDraftResult =
  ({ ok: true } & TaskDraft) | { ok: false; error: string };

const has = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key);

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Control, zero-width, bidirectional-override, invisible tag characters and lone surrogates are dropped. */
function hidden(code: number) {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    code === 0xad ||
    code === 0x61c ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xd800 && code <= 0xdfff) ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;

/** The selection as text: at most MAX_READ characters read, every line break a line feed, terminal escape sequences removed, hidden characters dropped; tab and line feed are the only control characters kept. */
function clean(value: string): string {
  const flat = value
    .slice(0, MAX_READ)
    .replace(/\r\n|[\r\u0085\u2028\u2029]/g, "\n")
    .replace(CSI, "")
    .replace(OSC, "");
  let text = "";
  for (const char of flat) {
    const code = char.codePointAt(0)!;
    if (code === 9 || code === 10 || !hidden(code)) text += char;
  }
  return text;
}

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;
const KNOWN_TOKEN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|npm_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/;
const ASSIGNED_SECRET =
  /\b(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|authorization|bearer)\b["']?\s*[:=]\s*["']?[^\s"']{6,}/i;

/** True when the text holds a known token shape, a password or token assignment, or a 40 character run of letters, digits and symbols with both cases and a digit; a warning only, never a refusal. */
function looksSecret(text: string): boolean {
  if (KNOWN_TOKEN.test(text) || ASSIGNED_SECRET.test(text)) return true;
  for (const run of text.matchAll(/[A-Za-z0-9+/_=-]{40,}/g))
    if (/[0-9]/.test(run[0]) && /[a-z]/.test(run[0]) && /[A-Z]/.test(run[0]))
      return true;
  return false;
}

/** Turns a terminal selection into a task draft: hidden characters and terminal escape sequences are dropped, line breaks are kept, the edges are trimmed, the subject is the first non-blank line cut to 120 characters and the brief is the whole text cut to 8,000 (truncated says so); a selection with no text, or one that holds a private key block, is refused with a reason that never repeats it. The optional suggested seat is kept as text and is only ever a suggestion. */
export function draftFromSelection(
  selection: unknown,
  opts: { suggested?: unknown } = {},
): TaskDraftResult {
  if (typeof selection !== "string" || !selection)
    return { ok: false, error: "Select some terminal text first." };
  const text = clean(selection).trim();
  if (!text)
    return {
      ok: false,
      error:
        "The selection holds only blank or invisible characters. Nothing was prepared.",
    };
  if (PRIVATE_KEY.test(text))
    return {
      ok: false,
      error:
        "The selection looks like a private key. HRig does not put keys into a task. Nothing was prepared.",
    };
  const first = text.split("\n").find((line) => line.trim()) || "";
  const line = Array.from(first.replace(/[\t ]+/g, " ").trim());
  const chars = Array.from(text);
  const suggested =
    plain(opts) && typeof opts.suggested === "string"
      ? Array.from(clean(opts.suggested).trim()).slice(0, 200).join("")
      : "";
  return {
    ok: true,
    subject:
      line.length > MAX_SUBJECT
        ? line
            .slice(0, MAX_SUBJECT - 3)
            .join("")
            .trimEnd() + "..."
        : line.join(""),
    body:
      chars.length > MAX_BODY
        ? chars.slice(0, MAX_BODY).join("").trimEnd()
        : text,
    truncated: selection.length > MAX_READ || chars.length > MAX_BODY,
    secretLike: looksSecret(text),
    suggested,
  };
}

/** The address of a seat when it is one of the seats given (a seat is written name@rig, as the Owner list writes it), else an empty string; anything that is not a listed seat is never accepted. */
export function validRecipient(address: unknown, seats: unknown): string {
  if (typeof address !== "string" || !address || !Array.isArray(seats))
    return "";
  for (const seat of seats) {
    if (!plain(seat) || !has(seat, "name") || !has(seat, "rigName")) continue;
    if (
      typeof seat.name === "string" &&
      typeof seat.rigName === "string" &&
      seat.name + "@" + seat.rigName === address
    )
      return address;
  }
  return "";
}

/** The line shown above the brief of a prepared draft: where it came from, whether it was cut, that nothing is created until the person presses Create assigned task, the standing secrets warning and, when the text looks like a key, token or password, a second warning. */
export function reviewNote(draft: TaskDraft): string {
  return (
    "Prepared from a terminal selection" +
    (draft.truncated
      ? ", cut to the first " + MAX_BODY.toLocaleString("en-US") + " characters"
      : "") +
    ". Review the subject, the brief and the owner: nothing is created until you press Create assigned task. " +
    SECRETS_WARNING +
    (draft.secretLike
      ? " This selection looks like it holds a key, token or password."
      : "")
  );
}

/** The line shown under the Owner list when the selection came from the terminal of a seat that is still listed; the seat is named, never chosen, and an empty string means no hint. */
export function ownerHint(draft: TaskDraft, seats: unknown): string {
  const seat = validRecipient(draft.suggested, seats);
  return seat
    ? "The selection came from the terminal of " +
        seat +
        ". Choose the owner yourself: none is chosen for you."
    : "";
}

/** Announces that a terminal's selection should open the Assign work dialog; the event carries the terminal id and the selected text only. */
export function publishTaskDraft(id: string, text: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TASK_DRAFT_EVENT, { detail: { id, text } }),
  );
}

/** Subscribes to those announcements and returns the unsubscribe; every payload is checked again with draftFromSelection, so a malformed event opens nothing. */
export function onTaskDraft(
  listener: (id: string, draft: TaskDraft) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    // Any script can dispatch this event, so only a well-formed payload reaches the app.
    const detail = (event as CustomEvent).detail;
    if (!plain(detail) || typeof detail.id !== "string" || !detail.id) return;
    const draft = draftFromSelection(detail.text);
    if (draft.ok)
      listener(detail.id, {
        subject: draft.subject,
        body: draft.body,
        truncated: draft.truncated,
        secretLike: draft.secretLike,
        suggested: "",
      });
  };
  window.addEventListener(TASK_DRAFT_EVENT, handler);
  return () => window.removeEventListener(TASK_DRAFT_EVENT, handler);
}

/** The one call every entry point makes: when the selection can become a draft it is announced for the terminal id and an empty string comes back, otherwise the reason it cannot (which never repeats the selection) comes back and nothing is announced. */
export function requestTaskDraft(id: string, selection: unknown): string {
  const draft = draftFromSelection(selection);
  if (!draft.ok) return draft.error;
  publishTaskDraft(id, selection as string);
  return "";
}
