import { PILOT_DISPLAY } from "./display-config";

const md = (d: Date, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone: PILOT_DISPLAY.timeZone }).format(d);

/**
 * A report bucket named by the days it covers ("Oct 12–18", "Oct 19–21, so far"), not just its
 * first day, so the latest bucket reads as part-way through. `end` is exclusive.
 */
export function bucketLabel(b: { start: Date | string; end: Date | string }, bucketDays: number) {
  const start = new Date(b.start);
  const end = new Date(b.end);
  const partial = end.getTime() - start.getTime() < bucketDays * 86_400_000 - 60_000;
  // Periods run from the time the report was made, not midnight: a full week is named by its seven
  // calendar days (the next one starts on the eighth); the latest, partial one ends today.
  const last = partial ? end : new Date(end.getTime() - 86_400_000);
  const sameDay = md(start) === md(last);
  const sameMonth = md(start, { month: "short" }) === md(last, { month: "short" });
  const range = sameDay
    ? md(start)
    : sameMonth
      ? `${md(start)}–${md(last, { day: "numeric" })}`
      : `${md(start)}–${md(last)}`;
  return partial ? `${range}, so far` : range;
}
