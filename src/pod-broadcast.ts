// Inert and not imported by any app code. It exists so the preview and
// confirmation rules of the design note docs/pod-broadcast.md are written
// down and tested before any broadcast is approved. Nothing here sends a
// message, reads a terminal, touches the disk or has a setting.

/** Most recipients one broadcast may have. A seat past it is reported as "over cap" and is never a recipient. */
export const MAX_RECIPIENTS = 8;
/** Longest broadcast text, in characters (code points). Stricter than the 50,000 limit of the seat message path. */
export const MAX_TEXT_CHARS = 10000;

/** Rows of the seat list that are read; later rows are ignored. */
const MAX_ROWS = 500;
/** Selected ids that are read; later ones are only counted. */
const MAX_SELECTED = 100;
/** Longest id or session that is read; a longer one counts as missing. */
const MAX_ID = 200;
/** Longest name, rig, pod, runtime or status that is shown; a name that had to be cut can not be sent to. */
const MAX_LABEL = 64;
const NO_POD = "(no pod)";

/** Why a seat can not be sent to, in the order the checks run. */
export type SeatProblem =
  | "person"
  | "terminal seat"
  | "unsafe name"
  | "no session"
  | "stopped"
  | "exited"
  | "failed";
/** Why a selected id is not a recipient: a seat problem, an id that is not in the list, a repeat, or the cap. */
export type ExcludeReason =
  SeatProblem | "unknown seat" | "duplicate" | "over cap";
/** Why a text is refused. */
export type TextProblem =
  | "not text"
  | "empty"
  | "too long"
  | "control characters"
  | "hidden characters";

/** One seat of a group, for display: id is the exact inventory id and is a key only, never shown; blocked is the reason it can not be a recipient, or an empty string. */
export type PodSeat = {
  id: string;
  name: string;
  address: string;
  runtime: string;
  status: string;
  blocked: SeatProblem | "";
};
/** The seats of one pod of one rig. rigId is a key only; pod is the shown name, "(no pod)" for seats without one. */
export type PodGroup = {
  rigId: string;
  rigName: string;
  pod: string;
  seats: PodSeat[];
};
/** One recipient, in the form it would be sent to: address is name@rig, shown whole. */
export type Recipient = {
  id: string;
  address: string;
  runtime: string;
  status: string;
};
/** One selected id that is not a recipient, with its reason; address is empty when the id names no seat. */
export type Excluded = { id: string; address: string; reason: ExcludeReason };
/** The preview: every recipient, every exclusion in the order selected, and how many selected ids were past the bound and not looked at. */
export type Preview = {
  recipients: Recipient[];
  excluded: Excluded[];
  unread: number;
};
/** The answer for a text: the exact text, or the reason it is refused. */
export type TextCheck =
  { ok: true; text: string } | { ok: false; reason: TextProblem };

// A person's seat, by the same conservative guess the needs-input sound
// uses: the inventory has no field for it. A wrong guess only leaves one
// seat out.
const PERSON_NAME = /^human(?:[-.][A-Za-z0-9._-]+)?$/i;
const PERSON_EXTERNAL = /^[A-Za-z0-9._:-]+@external$/;
// One plain word of an address: it does not start with a dash (an option),
// and has no space, at sign (a host) or comma (a list).
const SAFE_PART = /^[^\s@,-][^\s@,]*$/u;
// Control, format (zero-width, bidirectional, tag), line and paragraph
// separator characters and unpaired surrogates.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const FORMAT = /[\p{Cf}\p{Cs}]/u;

type Row = {
  id: string;
  rigId: string;
  rigName: string;
  rigOk: boolean;
  name: string;
  nameOk: boolean;
  pod: string;
  runtime: string;
  status: string;
  session: string;
};

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Text of a sensible length, else an empty string. */
function short(value: unknown): string {
  return typeof value === "string" && value.length <= MAX_ID ? value : "";
}

/** Visible text: hidden characters dropped, the ends trimmed, cut to MAX_LABEL characters on a code point boundary. Only the start of a long string is read. */
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  const head = value
    .slice(0, MAX_LABEL * 4)
    .replace(HIDDEN, "")
    .trim();
  let out = "";
  let count = 0;
  for (const char of head) {
    if (count === MAX_LABEL) break;
    out += char;
    count++;
  }
  return out.trim();
}

/** The part of an address, when it is shown exactly as it is and is one plain word. */
function whole(raw: unknown, shown: string): boolean {
  return typeof raw === "string" && raw === shown && SAFE_PART.test(shown);
}

/** The seat row in the fields this module uses, or null when it is not a usable row. Never throws. */
function read(raw: unknown): Row | null {
  try {
    if (!plain(raw)) return null;
    const id = short(raw.id);
    if (id === "") return null;
    const name = clean(raw.name);
    const rigName = clean(raw.rigName);
    return {
      id,
      rigId: short(raw.rigId),
      rigName,
      rigOk: whole(raw.rigName, rigName),
      name,
      nameOk: whole(raw.name, name),
      pod: clean(raw.pod),
      runtime: clean(raw.runtime),
      status: clean(raw.status),
      session: short(raw.session),
    };
  } catch {
    return null;
  }
}

/** The first reason this seat can not be sent to, or an empty string. */
function problem(row: Row): SeatProblem | "" {
  const runtime = row.runtime.toLowerCase();
  if (
    PERSON_NAME.test(row.name) ||
    PERSON_NAME.test(row.session.split("@")[0]) ||
    PERSON_EXTERNAL.test(row.session) ||
    runtime === "human"
  )
    return "person";
  // A terminal seat is a shell: the message path would send it the exact text.
  if (runtime === "terminal") return "terminal seat";
  if (!row.nameOk || !row.rigOk) return "unsafe name";
  if (row.session.trim() === "") return "no session";
  const status = row.status.toLowerCase();
  if (status === "stopped") return "stopped";
  if (status === "exited") return "exited";
  if (status === "failed") return "failed";
  return "";
}

const address = (row: Row): string => row.name + "@" + row.rigName;
const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The seats grouped by rig and pod, for choosing from: groups sorted by rig
 * name, rig id and pod, seats by name and id, every field cleaned of hidden
 * characters and cut to 64. A pod name is only unique inside its rig, so the
 * same pod name in two rigs is two groups. Each seat says why it can not be a
 * recipient, so it can be shown greyed. At most 500 rows are read; a repeated
 * id counts once; nothing passed in is changed. Never throws.
 */
export function podGroups(seats: unknown): PodGroup[] {
  try {
    if (!Array.isArray(seats)) return [];
    const groups = new Map<string, PodGroup>();
    const seen = new Set<string>();
    const limit = Math.min(seats.length, MAX_ROWS);
    for (let i = 0; i < limit; i++) {
      const row = read(seats[i]);
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      const key = JSON.stringify([row.rigId, row.pod]);
      let group = groups.get(key);
      if (!group) {
        group = {
          rigId: row.rigId,
          rigName: row.rigName,
          pod: row.pod === "" ? NO_POD : row.pod,
          seats: [],
        };
        groups.set(key, group);
      }
      group.seats.push({
        id: row.id,
        name: row.name,
        address: address(row),
        runtime: row.runtime,
        status: row.status,
        blocked: problem(row),
      });
    }
    const list = [...groups.values()];
    for (const group of list)
      group.seats.sort((a, b) => order(a.name, b.name) || order(a.id, b.id));
    return list.sort(
      (a, b) =>
        order(a.rigName, b.rigName) ||
        order(a.rigId, b.rigId) ||
        order(a.pod, b.pod),
    );
  } catch {
    return [];
  }
}

/**
 * The recipient preview for the ids a person ticked, in the order ticked.
 * Every selected id ends up in exactly one list: recipients (at most
 * MAX_RECIPIENTS, each shown as name@rig with its runtime and status) or
 * excluded with a reason: an id that names no seat, a repeat, a seat problem
 * (see SeatProblem) or over cap. The ids after the first 100 are not looked at
 * and only counted in unread; they are never recipients. Only the first 500
 * rows of the seat list are read. Nothing passed in is changed. Never throws:
 * input that is not two lists, or any failure, gives no recipients.
 */
export function previewRecipients(
  seats: unknown,
  selectedIds: unknown,
): Preview {
  try {
    if (!Array.isArray(seats) || !Array.isArray(selectedIds))
      return { recipients: [], excluded: [], unread: 0 };
    const byId = new Map<string, Row>();
    const rows = Math.min(seats.length, MAX_ROWS);
    for (let i = 0; i < rows; i++) {
      const row = read(seats[i]);
      if (row && !byId.has(row.id)) byId.set(row.id, row);
    }
    const recipients: Recipient[] = [];
    const excluded: Excluded[] = [];
    const named = new Set<string>();
    const picked = Math.min(selectedIds.length, MAX_SELECTED);
    for (let i = 0; i < picked; i++) {
      const id = short(selectedIds[i]);
      const row = id === "" ? undefined : byId.get(id);
      const shown = row ? address(row) : "";
      const why = row ? problem(row) : "";
      if (id === "") {
        excluded.push({ id, address: shown, reason: "unknown seat" });
      } else if (named.has(id)) {
        excluded.push({ id, address: shown, reason: "duplicate" });
      } else if (!row) {
        excluded.push({ id, address: shown, reason: "unknown seat" });
      } else if (why !== "") {
        excluded.push({ id, address: shown, reason: why });
      } else if (recipients.length >= MAX_RECIPIENTS) {
        excluded.push({ id, address: shown, reason: "over cap" });
      } else {
        recipients.push({
          id,
          address: shown,
          runtime: row.runtime,
          status: row.status,
        });
      }
      named.add(id);
    }
    return {
      recipients,
      excluded,
      unread: Math.max(0, selectedIds.length - MAX_SELECTED),
    };
  } catch {
    return { recipients: [], excluded: [], unread: 0 };
  }
}

/**
 * Checks a broadcast text. The answer carries the exact text: nothing is
 * trimmed, so what is shown for review is what would be sent. Refused: a
 * value that is not text, a text that is empty or only white space, one over
 * MAX_TEXT_CHARS characters (an emoji counts as one), control characters
 * other than line feed and tab (carriage return, escape, NUL, DEL, the C1
 * range, line and paragraph separators) and hidden characters (zero-width,
 * bidirectional and tag characters, unpaired surrogates). Never throws.
 */
export function validateBroadcastText(value: unknown): TextCheck {
  if (typeof value !== "string") return { ok: false, reason: "not text" };
  if (value.length > MAX_TEXT_CHARS * 2)
    return { ok: false, reason: "too long" };
  if (value.trim() === "") return { ok: false, reason: "empty" };
  if (Array.from(value).length > MAX_TEXT_CHARS)
    return { ok: false, reason: "too long" };
  const body = value.replace(/[\n\t]/g, "");
  if (CONTROL.test(body)) return { ok: false, reason: "control characters" };
  if (FORMAT.test(body)) return { ok: false, reason: "hidden characters" };
  return { ok: true, text: value };
}

/** The words a person must type to confirm a broadcast to `count` recipients: the count as a decimal string. Empty when the count is not a whole number from 1 to MAX_RECIPIENTS, so such a broadcast can not be confirmed. */
export function confirmationPhrase(count: unknown): string {
  return typeof count === "number" &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= MAX_RECIPIENTS
    ? String(count)
    : "";
}

/** True only when the typed phrase is exactly the phrase for the count: no trimming, no leading zeros, no other digits. */
export function confirmed(phrase: unknown, count: unknown): boolean {
  const expected = confirmationPhrase(count);
  return expected !== "" && phrase === expected;
}
