"use strict";
const vm = require("node:vm");
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
  MAX_GLOBS: 20,
  MAX_GLOB: 200,
  FILE_MS: 2000,
});

const OPTION_FLAGS = ["regex", "wholeWord"];
const OPTION_GLOBS = ["include", "exclude"];

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
 * The regular expression scan of one file: the indexes of the first matching
 * lines. It is self-contained so its source can run in a fresh vm context,
 * where a time limit can stop a runaway match (see scanBounded).
 */
function findLines(text, source, flags, cap, maxHits) {
  const re = new RegExp(source, flags);
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (re.test(line.length > cap ? line.slice(0, cap) : line)) {
      hits.push(i);
      if (hits.length >= maxHits) break;
    }
  }
  return hits;
}

/**
 * Returns scan(text, maxHits, timeoutMs) for a pattern: findLines run in a
 * private vm context with a wall-clock limit. It answers the line indexes, or
 * null when the limit stopped a runaway match. The context holds nothing but
 * the five values assigned for the call.
 */
function scanBounded(source, flags) {
  const context = vm.createContext({});
  const script = new vm.Script(
    `(${findLines.toString()})(text, source, flags, cap, maxHits)`,
  );
  return (text, maxHits, timeoutMs) => {
    context.text = text;
    context.source = source;
    context.flags = flags;
    context.cap = LIMITS.MAX_LINE;
    context.maxHits = maxHits;
    try {
      const options = Number.isFinite(timeoutMs)
        ? { timeout: Math.max(1, Math.ceil(timeoutMs)) }
        : {};
      return Array.from(script.runInContext(context, options));
    } catch (e) {
      if (e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return null;
      throw e;
    }
  };
}

/**
 * Compiles the search text into {test(line), scan, risky, literal}. With both
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
      scan: null,
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
    scan: risky ? scanBounded(source, "iu") : null,
    source,
    flags: "iu",
  };
}

/** Checks the options object of a search request; unknown keys and wrong types are refused. */
function normalizeSearchOptions(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { error: "Invalid search options." };
  for (const key of Object.keys(raw))
    if (!OPTION_FLAGS.includes(key) && !OPTION_GLOBS.includes(key))
      return { error: "Invalid search options." };
  for (const key of OPTION_FLAGS)
    if (raw[key] !== undefined && typeof raw[key] !== "boolean")
      return { error: "Invalid search options." };
  for (const key of OPTION_GLOBS)
    if (raw[key] !== undefined && typeof raw[key] !== "string")
      return { error: "Invalid search options." };
  const options = {
    regex: raw.regex === true,
    wholeWord: raw.wholeWord === true,
  };
  for (const key of OPTION_GLOBS)
    if (raw[key] !== undefined) options[key] = raw[key];
  return { options };
}

function codePoints(text) {
  return Array.from(text);
}

// One name: * matches any run of characters, ? exactly one; no backtracking blow-up.
function nameMatches(pattern, name) {
  const pat = codePoints(pattern);
  const text = codePoints(name);
  let p = 0;
  let n = 0;
  let star = -1;
  let mark = 0;
  while (n < text.length) {
    if (p < pat.length && pat[p] === "*") {
      star = p++;
      mark = n;
    } else if (p < pat.length && (pat[p] === "?" || pat[p] === text[n])) {
      p++;
      n++;
    } else if (star >= 0) {
      p = star + 1;
      n = ++mark;
    } else return false;
  }
  while (p < pat.length && pat[p] === "*") p++;
  return p === pat.length;
}

// A whole path: a segment that is exactly ** matches any number of folders.
function pathMatches(segments, parts) {
  let p = 0;
  let n = 0;
  let star = -1;
  let mark = 0;
  while (n < parts.length) {
    if (p < segments.length && segments[p] === "**") {
      star = p++;
      mark = n;
    } else if (p < segments.length && nameMatches(segments[p], parts[n])) {
      p++;
      n++;
    } else if (star >= 0) {
      p = star + 1;
      n = ++mark;
    } else return false;
  }
  while (p < segments.length && segments[p] === "**") p++;
  return p === segments.length;
}

/** Splits the comma separated text of an include or exclude field into trimmed, non-empty globs. */
function splitGlobs(text) {
  return String(text)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Normalizes one glob into {anchored, segments} or {error}. Globs are
 * project-relative with forward slashes; * and ? work inside one name and a
 * whole segment ** crosses folders. A glob with no slash matches a file or
 * folder name at any depth, one with a slash (or a leading ./) starts at the
 * project folder. Absolute paths, .., backslashes, control characters,
 * braces, classes and a leading ! are refused.
 */
function normalizeGlob(raw) {
  if (typeof raw !== "string" || !raw) return { error: "Empty glob." };
  if (raw.length > LIMITS.MAX_GLOB)
    return { error: `A glob can be at most ${LIMITS.MAX_GLOB} characters.` };
  for (let k = 0; k < raw.length; k++) {
    const c = raw.charCodeAt(k);
    if (c < 32 || c === 127 || c === 8232 || c === 8233)
      return { error: "A glob cannot contain control characters." };
  }
  if (raw.includes("\\"))
    return { error: "Use forward slashes in globs, never backslashes." };
  if (/[{}[\]]/.test(raw))
    return {
      error:
        "Braces and character classes are not supported in globs; list each glob separately.",
    };
  if (raw[0] === "!")
    return { error: "Use the exclude field instead of a leading !." };
  if (raw[0] === "/" || /^[A-Za-z]:/.test(raw) || /^~(\/|$)/.test(raw))
    return { error: "Globs are relative to the project folder, not absolute." };
  const dotSlash = raw.startsWith("./");
  const segments = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..")
      return {
        error: "Globs cannot contain .. (they stay inside the project).",
      };
    const segment = part === "**" ? part : part.replace(/\*+/g, "*");
    if (segment === "**" && segments[segments.length - 1] === "**") continue;
    segments.push(segment);
  }
  if (!segments.length) return { error: "Empty glob." };
  const anchored = segments.length > 1 || dotSlash;
  if (!anchored && segments[0] === "**") segments[0] = "*";
  return { anchored, segments };
}

function globHits(glob, parts) {
  if (!glob.anchored)
    return parts.some((name) => nameMatches(glob.segments[0], name));
  for (let k = 1; k <= parts.length; k++)
    if (pathMatches(glob.segments, parts.slice(0, k))) return true;
  return false;
}

function normalizeGlobList(input, label) {
  let raws;
  if (Array.isArray(input))
    raws = input.map((item) => (typeof item === "string" ? item.trim() : item));
  else if (
    typeof input === "string" &&
    input.length <= LIMITS.MAX_GLOBS * (LIMITS.MAX_GLOB + 1)
  )
    raws = splitGlobs(input);
  else return { error: `${label}: invalid glob list.` };
  if (raws.length > LIMITS.MAX_GLOBS)
    return { error: `${label}: at most ${LIMITS.MAX_GLOBS} globs.` };
  const list = [];
  for (const raw of raws) {
    const glob = normalizeGlob(raw);
    if (glob.error) return { error: `${label}: ${glob.error}` };
    list.push(glob);
  }
  return { list };
}

/**
 * Compiles the include and exclude globs (arrays of globs, or comma separated
 * texts) into {allow(relativePath), include, exclude} or {error}. A file is searched when it matches an include glob (or
 * there is none) and no exclude glob; a glob also matches through the folders
 * above the file. Globs only filter the walk: they never add a path to it.
 * include and exclude are the normalized lists a remote script receives.
 */
function compileGlobs(includeText = "", excludeText = "") {
  const include = normalizeGlobList(includeText, "Include");
  if (include.error) return { error: include.error };
  const exclude = normalizeGlobList(excludeText, "Exclude");
  if (exclude.error) return { error: exclude.error };
  const hit = (list, parts) => list.some((glob) => globHits(glob, parts));
  return {
    allow(relative) {
      const parts = String(relative).split("/");
      return (
        (!include.list.length || hit(include.list, parts)) &&
        !hit(exclude.list, parts)
      );
    },
    include: include.list.map((g) => ({ a: g.anchored, s: g.segments })),
    exclude: exclude.list.map((g) => ({ a: g.anchored, s: g.segments })),
    active: include.list.length + exclude.list.length > 0,
  };
}

/** A wall-clock budget over an injected clock; a budget of Infinity never expires. */
function createBudget(now, ms) {
  const start = now();
  return {
    expired: () => ms !== Infinity && now() - start >= ms,
    remaining: () =>
      ms === Infinity ? Infinity : Math.max(0, ms - (now() - start)),
  };
}

/**
 * Validates a searchText request and returns what the walk needs: test(line),
 * allows(relativePath), risky, budgetMs and options (what a remote script receives, null for a
 * request without options, which keeps the original behavior and result).
 * Throws an Error with a message fit for the user.
 */
function prepare(request, remote = false, hooks = {}) {
  if (request.options === undefined) {
    return {
      legacy: true,
      options: null,
      test: compileQuery({ query: request.query }).test,
      allows: () => true,
      scan: null,
      risky: false,
      budgetMs: Infinity,
    };
  }
  const normalized = normalizeSearchOptions(request.options);
  if (normalized.error) throw new Error(normalized.error);
  const { regex, wholeWord, include, exclude } = normalized.options;
  const compiled = compileQuery({
    query: request.query,
    regex,
    wholeWord,
    portable: remote,
  });
  if (compiled.error) throw new Error(compiled.error);
  const globs = compileGlobs(include, exclude);
  if (globs.error) throw new Error(globs.error);
  const budgetMs = hooks.budgetMs ?? LIMITS.BUDGET_MS;
  return {
    legacy: false,
    options: {
      regex,
      wholeWord,
      include: globs.include,
      exclude: globs.exclude,
      budgetMs,
      ...(hooks.maxFiles ? { maxFiles: hooks.maxFiles } : {}),
    },
    test: compiled.test,
    allows: globs.allow,
    scan: compiled.scan,
    risky: compiled.risky,
    budgetMs,
  };
}

module.exports = {
  LIMITS,
  escapeRegExp,
  inspectPattern,
  findLines,
  compileQuery,
  normalizeSearchOptions,
  splitGlobs,
  normalizeGlob,
  compileGlobs,
  createBudget,
  prepare,
};
