/**
 * A deletion stamp as a distance in the largest whole unit that fits.
 *
 * The page reads "2 days ago" rather than a column of timestamps, and the
 * exact instant is still available on hover. The ladder is ours; only the
 * wording is `Intl.RelativeTimeFormat`'s, which is why the unit and count are
 * exported separately for tests and the formatted string is a thin wrapper.
 *
 * Months and years use the average Gregorian lengths (365.2425 days, and a
 * twelfth of that for a month) rather than 30- and 365-day stand-ins. Months
 * are floored so the band never reaches a twelfth month — a 360-day-old
 * deletion reads "11 months ago", not "12 months ago", because a year is the
 * branch above. Years round: the next year is far enough away that 730 days
 * should read "2 years ago" rather than stopping at one.
 */

import { timestampMillis } from "@arcula/shared";
import type { Timestamp } from "@arcula/shared";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365.2425 * DAY;
const MONTH = YEAR / 12;

/** A distance as the unit that reads it and the signed count in that unit. */
export interface RelativeTimePart {
  readonly unit: Intl.RelativeTimeFormatUnit;
  readonly value: number;
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", YEAR],
  ["month", MONTH],
  ["week", WEEK],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/**
 * The unit and count for `deletedAt` relative to `now` (the wall clock by
 * default). Past stamps are negative, so `format` reads "… ago".
 */
export function relativeTimePart(
  deletedAt: Timestamp,
  now: number = Date.now(),
): RelativeTimePart {
  const distance = timestampMillis(deletedAt) - now;
  const magnitude = Math.abs(distance);
  const sign = distance < 0 ? -1 : 1;

  for (const [unit, size] of UNITS) {
    if (magnitude < size) continue;
    const count =
      unit === "year"
        ? Math.round(magnitude / size)
        : Math.floor(magnitude / size);
    return { unit, value: sign * count };
  }

  return { unit: "second", value: sign * Math.floor(magnitude / SECOND) };
}

/** The deletion distance as the page reads it ("2 days ago"). */
export function relativeTime(
  deletedAt: Timestamp,
  now: number = Date.now(),
): string {
  const { unit, value } = relativeTimePart(deletedAt, now);
  return relative.format(value, unit);
}
