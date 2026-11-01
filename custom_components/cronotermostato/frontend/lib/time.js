// Pure time helpers (no DOM, no window). Times are "HH:MM" text; minutes run
// from midnight, 0..1440. "24:00" (1440) is valid only as the end of a band.

const LENIENT = /^(\d{1,2}):(\d{2})$/;
const STRICT = /^(\d{2}):(\d{2})$/;

export const MINUTES_PER_DAY = 1440;

/**
 * Parse "HH:MM" into minutes from midnight, or null if it is not a valid time.
 * "H:MM" is accepted while typing unless `strict` is set (the server wants two
 * digits). "24:00" is accepted only with `asEnd`.
 */
export function parseTime(text, { asEnd = false, strict = false } = {}) {
  if (typeof text !== "string") return null;
  const match = (strict ? STRICT : LENIENT).exec(text);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  const total = hours * 60 + minutes;
  if (total > MINUTES_PER_DAY) return null;
  if (total === MINUTES_PER_DAY && !asEnd) return null;
  return total;
}

/** Format minutes (0..1440) as "HH:MM". */
export function formatTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`Invalid minutes: ${String(minutes)}`);
  }
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}
