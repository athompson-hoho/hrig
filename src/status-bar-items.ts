/** One status bar item a person can hide: the id written in the setting and the words used for it in the docs. */
export interface StatusItem {
  id: string;
  label: string;
}

/** Every status bar item in the order the bar draws them, left to right. */
export const STATUS_ITEMS: readonly StatusItem[] = Object.freeze(
  [
    { id: "accounts", label: "Accounts" },
    { id: "connection", label: "Connection" },
    { id: "source-control", label: "Source control" },
    { id: "reconnect", label: "Reconnect dropped terminals" },
    { id: "sessions", label: "Sessions open" },
    { id: "layout", label: "Layout autosaved" },
    { id: "activity", label: "Activity button" },
  ].map((item) => Object.freeze(item)),
);

/** The longest hidden-items text read: the limit the generic text setting rule already has. */
export const MAX_HIDDEN_TEXT = 300;

/** The most words read from the hidden-items text. */
export const MAX_HIDDEN_WORDS = 32;

const KNOWN: ReadonlySet<string> = new Set(STATUS_ITEMS.map((item) => item.id));

/** The two thin dividers that are still drawn between shown items. */
export interface StatusDividers {
  afterReconnect: boolean;
  betweenSessionsAndLayout: boolean;
}

/**
 * The ids a setting text hides. Words are separated by commas or white space
 * and compared without case; only the first 300 characters and 32 words are
 * read, a repeated id counts once and a word that is not in the catalog is
 * dropped. Anything that is not text hides nothing.
 */
export function parseHidden(text: unknown): Set<string> {
  const hidden = new Set<string>();
  if (typeof text !== "string") return hidden;
  const words = text
    .slice(0, MAX_HIDDEN_TEXT)
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, MAX_HIDDEN_WORDS);
  for (const word of words) if (KNOWN.has(word)) hidden.add(word);
  return hidden;
}

/** True unless the id is in the hidden set. An id outside the catalog is never hidden, and anything that is not a set hides nothing. */
export function isVisible(
  id: string,
  hidden: ReadonlySet<string> | null | undefined,
): boolean {
  return !hidden || typeof hidden.has !== "function" || !hidden.has(id);
}

/** The canonical setting text for hidden ids: catalog order, joined by a comma and a space, ids outside the catalog dropped. Nothing hidden gives empty text, the setting's default. */
export function serialize(hidden: Iterable<string> | null | undefined): string {
  if (!hidden || typeof hidden === "string") return "";
  if (typeof (hidden as Iterable<string>)[Symbol.iterator] !== "function")
    return "";
  const set = new Set(hidden);
  return STATUS_ITEMS.filter((item) => set.has(item.id))
    .map((item) => item.id)
    .join(", ");
}

/** Which dividers still separate two shown items: the one after the reconnect button needs a shown item after it, the one between the session count and the layout note needs both. */
export function statusDividers(
  hidden: ReadonlySet<string> | null | undefined,
): StatusDividers {
  const show = (id: string) => isVisible(id, hidden);
  return {
    afterReconnect: show("sessions") || show("layout") || show("activity"),
    betweenSessionsAndLayout: show("sessions") && show("layout"),
  };
}
