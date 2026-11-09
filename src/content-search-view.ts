export type SearchOptions = { regex: boolean; wholeWord: boolean };
export type SearchMatch = { path: string; line: number; text: string };
export type SearchOutcome = {
  matches: SearchMatch[];
  truncated: boolean;
  reason: string;
};

/** Every search option off: the literal, case-insensitive search of old. */
export const defaultSearchOptions: SearchOptions = {
  regex: false,
  wholeWord: false,
};

/** The editor request for a project text search; the options object is always sent so the answer says why it stopped. */
export function buildSearchRequest(query: string, options: SearchOptions) {
  return {
    op: "searchText",
    query,
    options: { regex: options.regex, wholeWord: options.wholeWord },
  };
}

function matchRow(row: unknown): SearchMatch | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  if (typeof value.path !== "string" || typeof value.line !== "number")
    return null;
  return {
    path: value.path,
    line: value.line,
    text: typeof value.text === "string" ? value.text : "",
  };
}

/** Reads a searchText answer (the plain list of old or the object with a stop reason) and never throws. */
export function readSearchOutcome(result: unknown): SearchOutcome {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object"
      ? (result as { matches?: unknown }).matches
      : [];
  const matches = (Array.isArray(rows) ? rows : [])
    .map(matchRow)
    .filter((row): row is SearchMatch => row !== null);
  const reason =
    result && !Array.isArray(result) && typeof result === "object"
      ? (result as { reason?: unknown }).reason
      : "";
  const known = reason === "matches" || reason === "files" || reason === "time";
  return { matches, truncated: known, reason: known ? String(reason) : "" };
}

/** The note under the search box: the literal sentence stays as it was when no option is on. */
export function searchNote(options: SearchOptions): string {
  const kind = options.regex ? "Regular expression" : "Literal";
  const word = options.wholeWord ? ", whole word" : "";
  return `${kind}, case-insensitive${word} search. Up to 200 matches across 20,000 files; dependencies and binaries are excluded.`;
}

/** The status line shown when a search stopped early; empty when it ran to the end. */
export function stopNote(outcome: SearchOutcome): string {
  if (outcome.reason === "matches")
    return "Showing the first 200 matches; there may be more. Narrow the search to see others.";
  if (outcome.reason === "files")
    return "Stopped after 20,000 files; matches in files not reached are not shown.";
  if (outcome.reason === "time")
    return "Stopped at the time limit; only the matches found so far are shown.";
  return "";
}
