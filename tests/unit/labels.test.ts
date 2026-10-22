import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REASONS } from "@/domain/policy/reason-codes";
import { AUDIT_LABELS, REASON_LABELS, auditLabel, reasonLabel } from "@/domain/labels";

const SRC = path.resolve(__dirname, "../../src");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

describe("plain-language labels for internal codes", () => {
  it("covers every release-check reason code", () => {
    expect(Object.keys(REASON_LABELS).sort()).toEqual(Object.keys(REASONS).sort());
  });

  it("covers every audit action the app writes", () => {
    const written = new Set<string>();
    for (const f of walk(path.join(SRC, "server")).concat(walk(path.join(SRC, "fixtures")))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(
        /action:\s*(?:[^"\n]*\?\s*)?"([a-z_]+\.[a-z_]+)"(?:\s*:\s*"([a-z_]+\.[a-z_]+)")?/g,
      )) {
        written.add(m[1]!);
        if (m[2]) written.add(m[2]);
      }
    }
    const missing = [...written].filter((a) => !(a in AUDIT_LABELS));
    expect(written.size).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it("never shows a raw code, even for an unknown one", () => {
    expect(reasonLabel("SCOPE_EMPTY")).toBe("Nothing selected to share");
    expect(auditLabel("session.started")).toBe("Signed in");
    expect(auditLabel("something.new_event")).toBe("Something new event");
  });
});
