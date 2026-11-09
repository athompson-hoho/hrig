/** Shortest time, in milliseconds, between two sounds. A seat that newly needs input inside it is not lost: it sounds at the first answer after the pause, if it is still waiting. */
export const SOUND_COOLDOWN_MS = 10000;
/** Most seats looked at in one answer; the rest are ignored, so what is remembered stays small and the same seats are looked at every time. */
export const MAX_ATTENTION_SEATS = 500;
/** Longest seat id, name or session read, in characters; a longer value counts as missing. */
export const MAX_SEAT_ID = 200;

/** What was seen at the last answer of one connection: its key, the ids of the seats that were waiting (null until the first answer has been taken in silently) and when the last sound was due, in milliseconds (null for none). */
export type AttentionState = {
  connectionKey: string;
  attention: readonly string[] | null;
  lastPlayed: number | null;
};
/** Nothing seen yet: the next answer is only taken in, with no sound. */
export const NO_ATTENTION: AttentionState = Object.freeze({
  connectionKey: "",
  attention: null,
  lastPlayed: null,
});

/** A person's seat: a name or the part of a session before the at sign that is human or human followed by a dash or dot and a name, or a session that ends in @external. A conservative guess at how OpenRig lists a person (the inventory has no field for it); a wrong guess only makes one seat silent. */
const PERSON_NAME = /^human(?:[-.][A-Za-z0-9._-]+)?$/i;
const PERSON_EXTERNAL = /^[A-Za-z0-9._:-]+@external$/;

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Text of a sensible length, else an empty string. */
function short(value: unknown): string {
  return typeof value === "string" && value.length <= MAX_SEAT_ID ? value : "";
}

/** The state when it has the right shape, else NO_ATTENTION, so a hostile or stale value can never throw or sound. */
function checked(state: unknown): AttentionState {
  if (!plain(state)) return NO_ATTENTION;
  const { connectionKey, attention, lastPlayed } = state;
  if (typeof connectionKey !== "string") return NO_ATTENTION;
  if (attention !== null) {
    if (!Array.isArray(attention) || attention.length > MAX_ATTENTION_SEATS)
      return NO_ATTENTION;
    if (!attention.every((id) => typeof id === "string")) return NO_ATTENTION;
  }
  if (lastPlayed !== null) {
    if (typeof lastPlayed !== "number" || !Number.isFinite(lastPlayed))
      return NO_ATTENTION;
  }
  return {
    connectionKey,
    attention: attention as readonly string[] | null,
    lastPlayed: lastPlayed as number | null,
  };
}

/** True when the row looks like a person's own seat, which never makes a sound. Reads only the name, the session and the runtime; anything that is not a row gives false. */
export function isPersonSeat(seat: unknown): boolean {
  if (!plain(seat)) return false;
  const session = short(seat.session);
  return (
    PERSON_NAME.test(short(seat.name)) ||
    PERSON_NAME.test(session.split("@")[0]) ||
    PERSON_EXTERNAL.test(session) ||
    short(seat.runtime).toLowerCase() === "human"
  );
}

/** True when a sound is allowed at `now`: a finite clock, and either no sound yet or at least SOUND_COOLDOWN_MS since the last. A clock that moved backwards never blocks. */
function allowed(now: number, lastPlayed: number | null): boolean {
  if (!Number.isFinite(now)) return false;
  if (lastPlayed === null) return true;
  const elapsed = now - lastPlayed;
  return elapsed < 0 || elapsed >= SOUND_COOLDOWN_MS;
}

/**
 * One answer of the inventory: the state to keep and whether to sound.
 * A seat is waiting when its status is exactly attention and it is not a
 * person's seat. The first answer of a connection (or after a switch to
 * another one) is only taken in: it never sounds. Later, a waiting seat that
 * was not waiting at the last answer is new; one or many new seats give one
 * sound, and not before SOUND_COOLDOWN_MS after the last. A new seat that
 * arrived inside the pause is not marked as seen, so it sounds at the first
 * answer after the pause if it still waits. A seat that stops waiting and
 * waits again is new again. An answer that is not a list changes nothing.
 * At most MAX_ATTENTION_SEATS rows are read; ids are only compared, never
 * shown; the state passed in is not changed.
 */
export function nextAttention(
  state: AttentionState,
  connectionKey: string,
  seats: unknown,
  now: number,
): { state: AttentionState; play: boolean } {
  const prev = checked(state);
  if (typeof connectionKey !== "string") return { state: prev, play: false };
  const known =
    prev.connectionKey === connectionKey && prev.attention !== null
      ? new Set(prev.attention)
      : null;
  if (!Array.isArray(seats))
    return {
      state: known
        ? prev
        : { connectionKey, attention: null, lastPlayed: prev.lastPlayed },
      play: false,
    };
  const current: string[] = [];
  const found = new Set<string>();
  const limit = Math.min(seats.length, MAX_ATTENTION_SEATS);
  for (let i = 0; i < limit; i++) {
    const seat: unknown = seats[i];
    if (!plain(seat) || seat.status !== "attention") continue;
    const id = short(seat.id);
    if (id === "" || found.has(id) || isPersonSeat(seat)) continue;
    found.add(id);
    current.push(id);
  }
  if (!known)
    return {
      state: { connectionKey, attention: current, lastPlayed: prev.lastPlayed },
      play: false,
    };
  const fresh = current.some((id) => !known.has(id));
  const play = fresh && allowed(now, prev.lastPlayed);
  return {
    state: {
      connectionKey,
      attention: play ? current : current.filter((id) => known.has(id)),
      lastPlayed: play ? now : prev.lastPlayed,
    },
    play,
  };
}
