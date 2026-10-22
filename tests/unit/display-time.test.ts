import { describe, expect, it } from "vitest";
import { PILOT_DISPLAY } from "@/domain/display-config";
import { dateOnly, dateTime, stamp } from "@/lib/client";

describe("display time", () => {
  it("renders stored UTC times in the configured pilot zone", () => {
    expect(PILOT_DISPLAY.timeZone).toBe("America/New_York");
    // Winter (EST, UTC−5) and summer (EDT, UTC−4).
    expect(stamp(new Date("2026-01-15T17:05:00Z"))).toBe("Jan 15, 2026, 12:05 PM ET");
    expect(stamp(new Date("2026-07-04T16:30:00Z"))).toBe("Jul 4, 2026, 12:30 PM ET");
  });

  it("puts a late-evening UTC time on the right local day", () => {
    const t = new Date("2026-10-12T02:15:00Z"); // 10:15 PM on Oct 11 in Eastern time
    expect(dateOnly(t)).toBe("Oct 11, 2026");
    expect(dateTime(t)).toBe("Oct 11, 10:15 PM");
    expect(stamp(t)).toBe("Oct 11, 2026, 10:15 PM ET");
  });

  it("handles the daylight-saving change without skipping or repeating", () => {
    // Nov 1, 2026: clocks fall back at 2:00 AM EDT.
    expect(stamp(new Date("2026-11-01T05:30:00Z"))).toBe("Nov 1, 2026, 1:30 AM ET");
    expect(stamp(new Date("2026-11-01T07:30:00Z"))).toBe("Nov 1, 2026, 2:30 AM ET");
  });
});
