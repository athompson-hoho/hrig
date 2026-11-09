import { snippetError } from "./terminal-commands";

/** The placeholder names a snippet may use, written {host}, {seat} and {project}. */
export const SNIPPET_TOKENS = ["host", "seat", "project"] as const;
/** The longest value one placeholder may expand to; a longer value is refused, never cut. */
export const MAX_CONTEXT_VALUE = 255;

/** One placeholder name. */
export type SnippetToken = (typeof SNIPPET_TOKENS)[number];
/** What a terminal tells a snippet about itself; a missing or blank entry means that placeholder is unavailable. */
export type SnippetContext = Partial<Record<SnippetToken, string>>;
/** Either the exact text to insert, or the reason nothing may be inserted. */
export type ExpandResult =
  | { ok: true; text: string; changed: boolean; careful: SnippetToken[] }
  | { ok: false; error: string };

// A doubled brace pair around a known name is an escape and comes out as one literal pair; a name after a dollar sign is shell syntax and stays; matches never overlap and are taken left to right.
const PLACEHOLDER =
  /\{\{(host|seat|project)\}\}|(?<!\$)\{(host|seat|project)\}/g;
// Characters a shell reads as more than plain text: a value holding one is flagged so the person quotes it in the snippet.
const SHELL_SPECIAL = /[\s"'`$&|;<>()\\*?!#{}[\]]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function baseName(root: unknown): string {
  if (typeof root !== "string") return "";
  const last =
    root
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? "";
  // A home marker, the current folder and a bare drive name say nothing about the project.
  return last === "~" ||
    last === "." ||
    last === ".." ||
    /^[A-Za-z]:$/.test(last)
    ? ""
    : last.trim();
}

/** Builds the context for one terminal: host is the connection host, else the distro, else local; seat is the seat name; project is the last folder of the root. */
export function snippetContext(
  connection: unknown,
  root: unknown,
  seat: unknown,
): SnippetContext {
  const context: SnippetContext = {};
  const c: Record<string, unknown> = isRecord(connection) ? connection : {};
  context.host = trimmed(c.host) || trimmed(c.distro) || "local";
  const seatName = isRecord(seat) ? trimmed(seat.name) : "";
  if (seatName) context.seat = seatName;
  const project = baseName(root);
  if (project) context.project = project;
  return context;
}

function contextValue(
  context: unknown,
  token: SnippetToken,
): { value: string } | { error: string } {
  const raw =
    isRecord(context) && Object.prototype.hasOwnProperty.call(context, token)
      ? context[token]
      : undefined;
  const value = trimmed(raw);
  if (!value)
    return {
      error: `{${token}} is not available in this terminal. Nothing was sent. Write {{${token}}} to keep the braces as they are.`,
    };
  if (value.length > MAX_CONTEXT_VALUE)
    return {
      error: `The value for {${token}} is longer than ${MAX_CONTEXT_VALUE} characters. Nothing was sent.`,
    };
  if (snippetError(value))
    return {
      error: `The value for {${token}} has control or invisible characters, so it cannot go into a single-line snippet. Nothing was sent.`,
    };
  return { value };
}

/** Replaces {host}, {seat} and {project} with the terminal's own values; any other brace text, and a name right after a dollar sign, stays as typed, {{host}} gives a literal {host}, and a missing or unusable value, or a result snippetError refuses, gives an error and no text. */
export function expand(text: string, context: SnippetContext): ExpandResult {
  if (typeof text !== "string") return { ok: false, error: "Invalid snippet." };
  const values = new Map<SnippetToken, string>();
  const careful: SnippetToken[] = [];
  let problem = "";
  const out = text.replace(
    PLACEHOLDER,
    (_match: string, escaped?: SnippetToken, token?: SnippetToken) => {
      if (escaped) return `{${escaped}}`;
      const name = token as SnippetToken;
      let value = values.get(name);
      if (value === undefined) {
        const found = contextValue(context, name);
        if ("error" in found) {
          problem = problem || found.error;
          return "";
        }
        value = found.value;
        values.set(name, value);
        if (SHELL_SPECIAL.test(value)) careful.push(name);
      }
      return value;
    },
  );
  if (problem) return { ok: false, error: problem };
  const refused = snippetError(out);
  if (refused) return { ok: false, error: refused };
  return { ok: true, text: out, changed: out !== text, careful };
}
