/**
 * How times are shown. Timestamps are stored in UTC; screens render them in one named display
 * zone so the server and the browser produce identical text.
 *
 * This synthetic pilot is a single Georgia hospice, so its configured default is US Eastern time.
 * It is a pilot setting, not a universal rule: supporting hospices in other states needs a
 * per-tenant zone (and, for families, a per-person zone) before any multi-state use.
 */
export const PILOT_DISPLAY = {
  timeZone: "America/New_York",
  /** Shown after audit-relevant times so they can't be misread in another zone. */
  zoneLabel: "ET",
} as const;
