import { PILOT_DISPLAY } from "@/domain/display-config";

/** Minutes after midnight, in the pilot's display time zone. */
function localMinutes(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PILOT_DISPLAY.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n("hour") * 60 + n("minute");
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Quiet hours may wrap past midnight (21:00–08:00). Equal start and end means none. */
export function inQuietHours(start: string, end: string, at: Date) {
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === b) return false;
  const now = localMinutes(at);
  return a < b ? now >= a && now < b : now >= a || now < b;
}
