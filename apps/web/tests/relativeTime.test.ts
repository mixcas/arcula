import { describe, expect, it } from "vitest";
import { relativeTimePart } from "../src/utils/relativeTime";
import type { Timestamp } from "@arcula/shared";

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A deletion stamp `distanceMs` before `NOW`, on the wire's second grid. */
const ago = (distanceMs: number): Timestamp => ({
  seconds: Math.floor((NOW - distanceMs) / SECOND),
  nanoseconds: 0,
});

/**
 * The ladder, boundary by boundary. The counts are what the page reads, so
 * they are asserted here rather than through `Intl`: the formatter's strings
 * are the library's, the unit each distance lands in is ours.
 */
describe("relativeTimePart — the unit ladder", () => {
  it.each([
    ["under a second is now", 0, "second", 0],
    ["one second", SECOND, "second", -1],
    ["fifty-nine seconds", 59 * SECOND, "second", -59],
    ["one minute", MINUTE, "minute", -1],
    ["fifty-nine minutes", 59 * MINUTE, "minute", -59],
    ["one hour", HOUR, "hour", -1],
    ["twenty-three hours", 23 * HOUR, "hour", -23],
    ["one day", DAY, "day", -1],
    ["six days", 6 * DAY, "day", -6],
    ["one week", 7 * DAY, "week", -1],
    ["thirty days is four whole weeks", 30 * DAY, "week", -4],
    ["thirty-one days tips into months", 31 * DAY, "month", -1],
    // A fixed 30-day month would round this to twelve months; an average
    // month keeps it inside the month band.
    ["three hundred and sixty days", 360 * DAY, "month", -11],
    ["a year", 366 * DAY, "year", -1],
    ["two years", 730 * DAY, "year", -2],
  ])("%s", (_label, distance, unit, value) => {
    expect(relativeTimePart(ago(distance), NOW)).toEqual({ unit, value });
  });
});
