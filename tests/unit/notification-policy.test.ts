import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Delivery rules for notifications (docs/notifications-and-messaging.md), checked statically:
 * every in-app notification's title is fixed text — never a name, household, health detail or
 * message text — and every link is an in-app path. The notification list itself repeats this
 * promise to people, so it must stay true.
 */
const DIR = path.resolve(__dirname, "../../src/server/services");
const calls = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts"))
  .flatMap((f) => {
    const text = readFileSync(path.join(DIR, f), "utf8");
    const out: { where: string; block: string }[] = [];
    let i = text.indexOf("notify(");
    while (i >= 0) {
      // The argument object of this call: up to the matching close of "notify(".
      let depth = 0;
      let j = i + "notify".length;
      for (; j < text.length; j++) {
        if (text[j] === "(") depth++;
        else if (text[j] === ")" && --depth === 0) break;
      }
      const line = text.slice(0, i).split("\n").length;
      out.push({ where: `${f}:${line}`, block: text.slice(i, j + 1) });
      i = text.indexOf("notify(", j);
    }
    return out.filter((c) => !c.block.startsWith("notify(\n  conn") && /title:/.test(c.block));
  });

describe("notification delivery rules", () => {
  it("finds the notification calls", () => {
    expect(calls.length).toBeGreaterThan(30);
  });

  it("uses fixed titles: no interpolated names, households or message text", () => {
    const bad = calls.filter(({ block }) => {
      const title = /title:\s*([\s\S]*?),\n\s*link:/.exec(block)?.[1] ?? "";
      return /\$\{|\+\s*\w|displayName|householdName|\bname\b|body/.test(title);
    });
    expect(bad.map((b) => b.where)).toEqual([]);
  });

  it("links only inside the app", () => {
    const bad = calls.filter(({ block }) => {
      // The whole link expression (it may be a conditional over several lines).
      const link = /link:\s*([\s\S]*?)(?:,\n\s*\w+:|,?\n\s*\}\))/.exec(block)?.[1] ?? "";
      const literals = [...link.matchAll(/["`]([^"`]*)["`]/g)].map((m) => m[1]!);
      const external = literals.some((l) => /:\/\/|^\/\/|mailto:|tel:/i.test(l));
      const inApp = literals.some((l) => /^\/(family|staff)(\/|$|\?)/.test(l));
      return external || !inApp;
    });
    expect(bad.map((b) => b.where)).toEqual([]);
  });
});
