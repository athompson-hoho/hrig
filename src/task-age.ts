/** One minute in milliseconds. */
export const MINUTE_MS = 60000;
/** One hour in milliseconds. */
export const HOUR_MS = 3600000;
/** One day in milliseconds. */
export const DAY_MS = 86400000;
/** Fields read, in order, for the time a task was created: tsCreated is the field OpenRig prints, the others are candidates. */
export const CREATED_KEYS: readonly string[] = [
  "tsCreated",
  "createdAt",
  "created_at",
  "created",
];
/** Fields read, in order, for the time a task last changed: tsUpdated is the field OpenRig prints, the others are candidates. */
export const UPDATED_KEYS: readonly string[] = [
  "tsUpdated",
  "updatedAt",
  "updated_at",
  "updated",
];
/** How long a task in each state may go without an update before it counts as stuck; states not listed are never stuck. */
export const STUCK_AFTER_MS: Readonly<Record<string, number>> = {
  "in-progress": DAY_MS,
  blocked: DAY_MS,
};

/** A time span: ms is the exact length, label the short form (5m, 3h, 2d). */
export type TaskAge = { ms: number; label: string };
/** What a card shows: text for the badge, title for the tooltip and whether the task is stuck. */
export type AgeBadge = { text: string; title: string; stuck: boolean };

const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const EPOCH = /^\d{9,16}$/;
/** Numbers below this are read as epoch seconds, numbers from it on as epoch milliseconds. */
const SECONDS_LIMIT = 1e11;
const MAX_TIME = 8.64e15;
const epoch = (n: number) => (n < SECONDS_LIMIT ? n * 1000 : n);

/** The day of an ISO text exists in its month (Date.parse alone would roll 31 February over to March). */
function realDay(text: string) {
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

const has = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key);

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A time as epoch milliseconds: an ISO 8601 text with a time and a zone (Z or an offset), an epoch number or a text of 9 to 16 digits (below 100 billion it counts as seconds); anything else gives null. */
export function parseTime(value: unknown): number | null {
  let time = NaN;
  if (typeof value === "number") time = epoch(value);
  else if (typeof value === "string") {
    const text = value.trim();
    if (text.length <= 40 && ISO.test(text) && realDay(text))
      time = Date.parse(text);
    else if (text.length <= 40 && EPOCH.test(text)) time = epoch(Number(text));
  }
  return Number.isFinite(time) && time > 0 && time <= MAX_TIME ? time : null;
}

/** The short form of a time span: under a minute is <1m, then whole minutes (5m), hours (3h) and days (2d); anything that is not a finite number of at least 0 gives an empty text. */
export function formatAge(ms: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < MINUTE_MS) return "<1m";
  if (ms < HOUR_MS) return Math.floor(ms / MINUTE_MS) + "m";
  if (ms < DAY_MS) return Math.floor(ms / HOUR_MS) + "h";
  return Math.floor(ms / DAY_MS) + "d";
}

function timeOf(item: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (!has(item, key)) continue;
    const time = parseTime(item[key]);
    if (time !== null) return time;
  }
  return null;
}

function span(from: number | null, now: number): TaskAge | null {
  if (from === null || typeof now !== "number" || !Number.isFinite(now))
    return null;
  if (from > now) return null;
  return { ms: now - from, label: formatAge(now - from) };
}

/** How long ago a task was created, from the first created field that holds a valid time; null when there is none or the time is in the future of now. */
export function ageOf(item: unknown, now: number): TaskAge | null {
  return plain(item) ? span(timeOf(item, CREATED_KEYS), now) : null;
}

/** How long ago a task last changed: the later of its updated and created times; null when neither is valid or the later one is in the future of now. */
export function idleOf(item: unknown, now: number): TaskAge | null {
  if (!plain(item)) return null;
  const updated = timeOf(item, UPDATED_KEYS);
  const created = timeOf(item, CREATED_KEYS);
  if (updated === null) return span(created, now);
  return span(created === null ? updated : Math.max(updated, created), now);
}

function stateOf(item: Record<string, unknown>): string {
  for (const key of ["status", "state"]) {
    if (has(item, key) && typeof item[key] === "string") {
      const state = (item[key] as string).trim().toLowerCase();
      if (state) return state;
    }
  }
  return "";
}

/** True when the task is in a state with a limit and has had no update for longer than that limit (strictly longer); the limits are an object of state to milliseconds, own keys only, and an entry that is not a finite number above 0 is ignored. */
export function isStuck(
  item: unknown,
  now: number,
  thresholds: Readonly<Record<string, number>> = STUCK_AFTER_MS,
): boolean {
  if (!plain(item)) return false;
  const limits = plain(thresholds) ? thresholds : STUCK_AFTER_MS;
  const state = stateOf(item);
  if (!state || !has(limits, state)) return false;
  const limit = limits[state];
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0)
    return false;
  const idle = idleOf(item, now);
  return idle !== null && idle.ms > limit;
}

/** The badge for a card: the age since creation, plus the word stuck when the task is stuck, with a tooltip that says how long it has had no update and how old it is; null when there is nothing to show. */
export function ageBadge(
  item: unknown,
  now: number,
  thresholds: Readonly<Record<string, number>> = STUCK_AFTER_MS,
): AgeBadge | null {
  const age = ageOf(item, now);
  const stuck = isStuck(item, now, thresholds);
  if (!age && !stuck) return null;
  const idle = stuck ? idleOf(item, now) : null;
  const text = [age ? age.label : "", stuck ? "stuck" : ""]
    .filter(Boolean)
    .join(" ");
  const title = [
    idle ? "Stuck: no update for " + idle.label : "",
    age ? "Created " + age.label + " ago" : "",
  ]
    .filter(Boolean)
    .join(". ");
  return { text, title, stuck };
}
