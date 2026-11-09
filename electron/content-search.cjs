"use strict";
// Project text search: the pure matcher, the regular expression pre-check and
// the request normalizer, shared by the main process and the tests. No
// file system, no process, no Electron: the walk itself lives in features.cjs.

/** Every limit of the content search, in one frozen table (docs and tests read it). */
const LIMITS = Object.freeze({
  MAX_QUERY: 300,
  MAX_PATTERN: 200,
  MAX_LINE: 1000,
  MAX_MATCHES: 200,
  MAX_FILES: 20000,
  MAX_FILE_BYTES: 2000000,
  MAX_TEXT: 250,
  MAX_DEPTH: 25,
  BUDGET_MS: 10000,
  MAX_UNBOUNDED: 3,
  MAX_DOUBLINGS: 10,
  MAX_REPEAT: 1000,
});

const OPTION_FLAGS = ["regex", "wholeWord"];

/** Escapes every regular expression syntax character so a literal can be embedded in a pattern. */
function escapeRegExp(text) {
  return String(text).replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

function reason(error) {
  return String((error && error.message) || error)
    .replace(/^Invalid regular expression: /, "")
    .slice(0, 160);
}

function hasControl(text) {
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if ((c < 32 && c !== 9) || c === 127 || c === 8232 || c === 8233)
      return true;
  }
  return false;
}

/** How many characters the escape at `at` takes: property and code point escapes include their braces. */
function escapeLength(pattern, at) {
  const next = pattern[at + 1];
  const braced =
    (next === "p" || next === "P" || next === "u") && pattern[at + 2] === "{";
  if (!braced) return 2;
  const close = pattern.indexOf("}", at + 3);
  return close < 0 ? 2 : close - at + 1;
}

function portableEscape(next, after) {
  if (next === "p" || next === "P")
    return "Unicode property escapes are not supported on WSL and SSH connections.";
  if (next === "u" && after === "{")
    return "Code point escapes are not supported on WSL and SSH connections.";
  if (next === "c")
    return "Control escapes are not supported on WSL and SSH connections.";
  return "";
}

/**
 * Pre-check for a user regular expression. Rejects what could run for a very
 * long time or behave differently on WSL and SSH: more than 200 characters,
 * control characters, invalid syntax, backreferences, lookbehind, named
 * groups, empty classes, repeat counts over 1,000, repeated groups without an
 * upper limit, repeated groups holding alternatives or optional parts, more
 * than 3 unbounded repeats and more than 10 doubling points (optional parts,
 * ranges and alternatives). Returns {error} or {unbounded, doublings, risky}.
 */
function inspectPattern(pattern, portable = false) {
  if (typeof pattern !== "string" || !pattern)
    return { error: "Enter a regular expression." };
  if (pattern.length > LIMITS.MAX_PATTERN)
    return {
      error: `A regular expression can be at most ${LIMITS.MAX_PATTERN} characters.`,
    };
  if (hasControl(pattern))
    return { error: "A regular expression cannot contain control characters." };
  try {
    new RegExp(pattern, "u");
  } catch (e) {
    return { error: "Invalid regular expression: " + reason(e) };
  }
  const n = pattern.length;
  const stack = [{ alt: false, variable: false }];
  let unbounded = 0;
  let doublings = 0;
  let last = "";
  let i = 0;
  while (i < n) {
    const ch = pattern[i];
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next >= "1" && next <= "9")
        return { error: "Backreferences are not supported." };
      if (next === "k")
        return { error: "Named backreferences are not supported." };
      const bad = portable ? portableEscape(next, pattern[i + 2]) : "";
      if (bad) return { error: bad };
      i += escapeLength(pattern, i);
      last = "atom";
    } else if (ch === "[") {
      let j = i + 1;
      if (pattern[j] === "^") j++;
      if (pattern[j] === "]")
        return { error: "Empty character classes are not supported." };
      while (j < n && pattern[j] !== "]") {
        if (pattern[j] === "\\") {
          const bad = portable
            ? portableEscape(pattern[j + 1], pattern[j + 2])
            : "";
          if (bad) return { error: bad };
          j += escapeLength(pattern, j);
        } else j++;
      }
      i = j + 1;
      last = "atom";
    } else if (ch === "(") {
      if (pattern[i + 1] === "?") {
        const kind = pattern[i + 2];
        if (kind === ":" || kind === "=" || kind === "!") i += 3;
        else if (kind === "<")
          return {
            error:
              pattern[i + 3] === "=" || pattern[i + 3] === "!"
                ? "Lookbehind is not supported."
                : "Named groups are not supported.",
          };
        else return { error: "This group syntax is not supported." };
      } else i += 1;
      stack.push({ alt: false, variable: false });
      last = "";
    } else if (ch === ")") {
      const frame = stack.pop();
      const parent = stack[stack.length - 1];
      parent.alt = parent.alt || frame.alt;
      parent.variable = parent.variable || frame.variable;
      last = { group: frame };
      i += 1;
    } else if (ch === "|") {
      stack[stack.length - 1].alt = true;
      doublings += 1;
      last = "";
      i += 1;
    } else if (ch === "*" || ch === "+" || ch === "?" || ch === "{") {
      let min = ch === "+" ? 1 : 0;
      let max = ch === "?" ? 1 : Infinity;
      let length = 1;
      if (ch === "{") {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i, i + 24));
        if (!m) return { error: "Invalid repeat count." };
        min = Number(m[1]);
        max = m[2] ? (m[3] === "" ? Infinity : Number(m[3])) : min;
        length = m[0].length;
      }
      if (
        min > LIMITS.MAX_REPEAT ||
        (max !== Infinity && max > LIMITS.MAX_REPEAT)
      )
        return {
          error: `A repeat count can be at most ${LIMITS.MAX_REPEAT}.`,
        };
      i += length;
      if (pattern[i] === "?") i += 1;
      const variable = max === Infinity || max > min;
      if (last && last.group) {
        if (max === Infinity)
          return {
            error: "A group cannot be repeated without an upper limit.",
          };
        if (last.group.alt || last.group.variable)
          return {
            error:
              "A repeated group cannot contain alternatives or optional parts.",
          };
      }
      if (max === Infinity) unbounded += 1;
      else if (max > min) doublings += Math.ceil(Math.log2(max - min + 1));
      if (variable) stack[stack.length - 1].variable = true;
      last = "";
    } else {
      i += 1;
      last = "atom";
    }
  }
  if (unbounded > LIMITS.MAX_UNBOUNDED)
    return {
      error: `At most ${LIMITS.MAX_UNBOUNDED} unbounded repeats (*, + or {n,}) are allowed.`,
    };
  if (doublings > LIMITS.MAX_DOUBLINGS)
    return {
      error: `Too many optional parts, ranges and alternatives (at most ${LIMITS.MAX_DOUBLINGS} points).`,
    };
  return { unbounded, doublings, risky: unbounded >= 2 || doublings > 3 };
}

/**
 * Compiles the search text into {test(line), risky, literal}. With both
 * options off it is exactly the original literal, case-insensitive substring
 * test. Regular expression and whole word searches use a Unicode, case-
 * insensitive pattern and test at most the first 1,000 characters of a line;
 * whole word means the characters before and after the match are not letters,
 * digits or underscore. Never throws: bad input gives {error}.
 */
function compileQuery({
  query,
  regex = false,
  wholeWord = false,
  portable = false,
}) {
  if (typeof query !== "string" || !query)
    return { error: "Enter search text." };
  if (query.length > LIMITS.MAX_QUERY)
    return {
      error: `Enter search text under ${LIMITS.MAX_QUERY} characters.`,
    };
  if (!regex && !wholeWord) {
    const needle = query.toLowerCase();
    return {
      test: (line) => line.toLowerCase().includes(needle),
      risky: false,
      literal: true,
    };
  }
  let source;
  let risky = false;
  if (regex) {
    const checked = inspectPattern(query, portable);
    if (checked.error) return { error: checked.error };
    source = query;
    risky = checked.risky;
  } else source = escapeRegExp(query);
  if (wholeWord)
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  let re;
  try {
    re = new RegExp(source, "iu");
  } catch (e) {
    return { error: "Invalid regular expression: " + reason(e) };
  }
  const cap = LIMITS.MAX_LINE;
  return {
    test: (line) => re.test(line.length > cap ? line.slice(0, cap) : line),
    risky,
    literal: false,
    source,
    flags: "iu",
  };
}

/** Checks the options object of a search request; unknown keys and wrong types are refused. */
function normalizeSearchOptions(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { error: "Invalid search options." };
  for (const key of Object.keys(raw))
    if (!OPTION_FLAGS.includes(key))
      return { error: "Invalid search options." };
  for (const key of OPTION_FLAGS)
    if (raw[key] !== undefined && typeof raw[key] !== "boolean")
      return { error: "Invalid search options." };
  return {
    options: { regex: raw.regex === true, wholeWord: raw.wholeWord === true },
  };
}

/** A wall-clock budget over an injected clock; a budget of Infinity never expires. */
function createBudget(now, ms) {
  const start = now();
  return { expired: () => ms !== Infinity && now() - start >= ms };
}

/**
 * Validates a searchText request and returns what the walk needs: test(line),
 * risky, budgetMs and options (what a remote script receives, null for a
 * request without options, which keeps the original behavior and result).
 * Throws an Error with a message fit for the user.
 */
function prepare(request, remote = false, hooks = {}) {
  if (request.options === undefined) {
    return {
      legacy: true,
      options: null,
      test: compileQuery({ query: request.query }).test,
      risky: false,
      budgetMs: Infinity,
    };
  }
  const normalized = normalizeSearchOptions(request.options);
  if (normalized.error) throw new Error(normalized.error);
  const compiled = compileQuery({
    query: request.query,
    ...normalized.options,
    portable: remote,
  });
  if (compiled.error) throw new Error(compiled.error);
  const budgetMs = hooks.budgetMs ?? LIMITS.BUDGET_MS;
  return {
    legacy: false,
    options: { ...normalized.options, budgetMs },
    test: compiled.test,
    risky: compiled.risky,
    budgetMs,
  };
}

module.exports = {
  LIMITS,
  escapeRegExp,
  inspectPattern,
  compileQuery,
  normalizeSearchOptions,
  createBudget,
  prepare,
};
