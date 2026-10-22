/**
 * Date parts in the pilot's display zone, assembled from numeric parts so the server and the browser
 * produce identical text (see PILOT_DISPLAY). Used by lib/client's formatters and by text the server
 * writes for families (decision 62).
 */
import { PILOT_DISPLAY } from "./display-config";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: PILOT_DISPLAY.timeZone,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function dateParts(d: Date | string) {
  const p: Record<string, string> = {};
  for (const x of partsFormat.formatToParts(new Date(d))) p[x.type] = x.value;
  return {
    month: MONTHS[Number(p["month"]) - 1] ?? "",
    day: p["day"] ?? "",
    year: p["year"] ?? "",
    hour: p["hour"] ?? "",
    minute: p["minute"] ?? "",
    period: (p["dayPeriod"] ?? "").toUpperCase().replace(/\./g, ""),
  };
}

/** "Oct 8, 4:25 PM": the family app's everyday date and time. */
export function familyDateTime(d: Date | string) {
  const p = dateParts(d);
  return `${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.period}`;
}
