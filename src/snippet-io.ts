import { snippetError, type TerminalSnippet } from "./terminal-commands";

/** The value of the format field in every export. */
export const SNIPPET_FORMAT = "hrig-snippets";
/** The only export version this build writes and reads. */
export const SNIPPET_VERSION = 1;
/** The most characters one import may hold (about 256 KB); a longer text is refused before it is parsed. */
export const MAX_IMPORT_CHARS = 262144;
/** The most snippets one import may hold; a longer list refuses the whole file. */
export const MAX_IMPORT_SNIPPETS = 200;
/** The longest snippet name, the same limit as the name box. */
export const MAX_SNIPPET_NAME = 80;

/** What an export carries per snippet: the name and the text, nothing else. */
export interface SnippetEntry {
  name: string;
  text: string;
}
/** A checked file: valid entries in file order, the items refused with a reason, repeats dropped, or a reason the whole file is refused. */
export interface ParseResult {
  snippets: SnippetEntry[];
  rejected: { index: number; reason: string }[];
  duplicates: number;
  error: string;
}
/** What merging would do or did: the new list and the counts. */
export interface MergeResult {
  snippets: TerminalSnippet[];
  added: number;
  duplicates: number;
  renamed: number;
  invalid: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}
function pairKey(name: string, text: string): string {
  return JSON.stringify([name, text]);
}
// Cuts to a number of UTF-16 units without leaving half of a surrogate pair.
function cutUnits(value: string, units: number): string {
  let out = value.slice(0, Math.max(0, units));
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

/** Empty when the name is usable: a string, not blank, at most 80 characters, one line, no control or invisible characters. */
export function nameError(name: unknown): string {
  if (typeof name !== "string") return "The name is missing.";
  const trimmed = name.trim();
  if (!trimmed) return "The name is empty.";
  if (trimmed.length > MAX_SNIPPET_NAME)
    return `The name is longer than ${MAX_SNIPPET_NAME} characters.`;
  // The same check the text gets, so a name cannot hide what a button says.
  if (snippetError(trimmed))
    return "The name has control or invisible characters.";
  return "";
}

/** The saved snippets that an export and an import would both accept, as fresh name and text pairs (the name trimmed, the text as saved). */
export function exportableSnippets(list: unknown): SnippetEntry[] {
  if (!Array.isArray(list)) return [];
  const out: SnippetEntry[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = own(item, "name");
    const text = own(item, "text");
    if (typeof name !== "string" || typeof text !== "string") continue;
    if (nameError(name) || snippetError(text)) continue;
    out.push({ name: name.trim(), text });
  }
  return out;
}

/** The export text for a snippet list, a JSON object with the format, the version and only each snippet's name and text, plus how many snippets it holds and whether one import can read it back whole. */
export function describeExport(list: unknown): {
  json: string;
  count: number;
  fits: boolean;
} {
  const snippets = exportableSnippets(list);
  const json = JSON.stringify(
    { format: SNIPPET_FORMAT, version: SNIPPET_VERSION, snippets },
    null,
    2,
  );
  return {
    json,
    count: snippets.length,
    fits:
      snippets.length <= MAX_IMPORT_SNIPPETS && json.length <= MAX_IMPORT_CHARS,
  };
}

/** The export text alone. */
export function exportSnippets(list: unknown): string {
  return describeExport(list).json;
}

function refuse(error: string): ParseResult {
  return { snippets: [], rejected: [], duplicates: 0, error };
}
function itemReason(item: unknown): string {
  if (!isRecord(item)) return "Not a snippet object.";
  const name = own(item, "name");
  const text = own(item, "text");
  const problem = nameError(name);
  if (problem) return problem;
  if (typeof text !== "string") return "The text is missing.";
  return snippetError(text);
}

/** Checks pasted export text without changing anything: the size, the JSON, the format and version, the count, then every item with the same checks a saved snippet gets. */
export function parseSnippets(input: unknown): ParseResult {
  if (typeof input !== "string")
    return refuse("Paste the exported snippet text first.");
  if (input.length > MAX_IMPORT_CHARS)
    return refuse(
      "The text is larger than 256 KB, which is more than HRig imports at once.",
    );
  // A byte order mark from an editor is not part of the data.
  const body = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (!body.trim()) return refuse("Paste the exported snippet text first.");
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return refuse("That is not valid JSON.");
  }
  if (!isRecord(data) || own(data, "format") !== SNIPPET_FORMAT)
    return refuse("That is not an HRig snippet export.");
  if (own(data, "version") !== SNIPPET_VERSION)
    return refuse("This snippet export has a version this HRig cannot read.");
  const list = own(data, "snippets");
  if (!Array.isArray(list)) return refuse("The export has no snippets list.");
  if (list.length > MAX_IMPORT_SNIPPETS)
    return refuse(
      `The export holds ${list.length} snippets and HRig imports at most ${MAX_IMPORT_SNIPPETS} at a time.`,
    );
  const snippets: SnippetEntry[] = [];
  const rejected: { index: number; reason: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  list.forEach((item, at) => {
    const reason = itemReason(item);
    if (reason) {
      rejected.push({ index: at + 1, reason });
      return;
    }
    const record = item as Record<string, unknown>;
    const name = (own(record, "name") as string).trim();
    const text = own(record, "text") as string;
    const key = pairKey(name, text);
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);
    snippets.push({ name, text });
  });
  return { snippets, rejected, duplicates, error: "" };
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const name =
      cutUnits(base, MAX_SNIPPET_NAME - suffix.length).trimEnd() + suffix;
    if (!taken.has(name)) return name;
  }
}

/** Adds the incoming entries after the saved ones and never changes or removes a saved one: an entry with the same name and text is skipped, one with only the same name is added under a numbered name, every added snippet gets an id from makeId (never one from the file), and an entry that fails the checks again is skipped and counted. */
export function mergeSnippets(
  existing: unknown,
  incoming: readonly SnippetEntry[],
  makeId: () => string,
): MergeResult {
  const snippets: TerminalSnippet[] = Array.isArray(existing)
    ? [...existing]
    : [];
  const names = new Set<string>();
  const pairs = new Set<string>();
  for (const item of snippets) {
    if (
      isRecord(item) &&
      typeof item.name === "string" &&
      typeof item.text === "string"
    ) {
      names.add(item.name);
      pairs.add(pairKey(item.name, item.text));
    }
  }
  const result: MergeResult = {
    snippets,
    added: 0,
    duplicates: 0,
    renamed: 0,
    invalid: 0,
  };
  const offered: readonly unknown[] = Array.isArray(incoming) ? incoming : [];
  for (const entry of offered) {
    const name0 = isRecord(entry) ? entry.name : undefined;
    const text = isRecord(entry) ? entry.text : undefined;
    if (nameError(name0) || typeof text !== "string" || snippetError(text)) {
      result.invalid++;
      continue;
    }
    const base = (name0 as string).trim();
    const original = pairKey(base, text);
    if (pairs.has(original)) {
      result.duplicates++;
      continue;
    }
    let name = base;
    if (names.has(name)) {
      name = uniqueName(base, names);
      result.renamed++;
    }
    names.add(name);
    pairs.add(original);
    pairs.add(pairKey(name, text));
    snippets.push({ id: makeId(), name, text });
    result.added++;
  }
  return result;
}
