import { describe, expect, it } from "vitest";
import { STATUS, STATUS_SOURCES, statusOf, type StatusDomain } from "@/domain/status";

/** Staff rework, section 4: one status map; every enum value has a label and tone. */
describe("status map", () => {
  for (const domain of Object.keys(STATUS_SOURCES) as StatusDomain[]) {
    it(`covers every ${domain} value, with plain labels`, () => {
      const map = STATUS[domain] as Record<string, { label: string; tone: string }>;
      for (const v of STATUS_SOURCES[domain]) {
        expect(map[v], `${domain}.${v}`).toBeDefined();
        expect(map[v]!.label).not.toMatch(/_/); // never a raw code
        expect(["neutral", "info", "success", "warning", "danger"]).toContain(map[v]!.tone);
      }
      // No stale entries for values that no longer exist.
      expect(Object.keys(map).sort()).toEqual([...STATUS_SOURCES[domain]].sort());
    });
  }
  it("falls back to readable words for an unknown value", () => {
    expect(statusOf("escalation", "some_new_state").label).toBe("some new state");
  });
});
