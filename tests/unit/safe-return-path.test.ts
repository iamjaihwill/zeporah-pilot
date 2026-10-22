import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/domain/sign-in";

/** After sign-in, people go back to the page they asked for — only if it's inside Zeporah and theirs. */
describe("safeReturnPath", () => {
  it("keeps a page that belongs to the account's own area, with its query and hash", () => {
    expect(safeReturnPath("/family/messages#entry-1", "family")).toBe("/family/messages#entry-1");
    expect(safeReturnPath("/staff/queue?view=mine", "staff")).toBe("/staff/queue?view=mine");
    expect(safeReturnPath("/helper", "family")).toBe("/helper");
    expect(safeReturnPath("/recipient/packets/pk-1", "recipient")).toBe("/recipient/packets/pk-1");
  });

  it("refuses other sites, tricks and other areas", () => {
    for (const bad of [
      "https://evil.example/family",
      "//evil.example/family",
      "/\\evil.example",
      "javascript:alert(1)",
      "family",
      "/familyx",
      "/staff/queue",
      "",
      undefined,
      42,
    ])
      expect(safeReturnPath(bad, "family")).toBeNull();
    expect(safeReturnPath("/family", "staff")).toBeNull();
    expect(safeReturnPath(`/family/${"a".repeat(600)}`, "family")).toBeNull();
  });
});
