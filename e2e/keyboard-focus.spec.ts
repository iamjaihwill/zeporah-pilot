import { expect, test } from "./fixtures";
import { open, resetData, signInAs } from "./helpers";

/**
 * Keyboard use of the enterprise screens (quality pass): tabbing through each, every element that
 * takes focus shows where focus is (an outline, a ring or the chart column ring) and has a size.
 */
const PAGES: [string, string][] = [
  ["Dana Brooks", "/staff"],
  ["Dana Brooks", "/staff/exceptions"],
  ["Dana Brooks", "/staff/team"],
  ["Dana Brooks", "/staff/reports"],
  ["Dana Brooks", "/staff/audit"],
  ["Maya Chen", "/staff"],
  ["Maya Chen", "/staff/households/hh-okafor"],
  ["Maya Chen", "/staff/households/hh-okafor/access"],
  ["Lena Hoffman", "/staff/admin"],
];

test("every focus stop on the enterprise screens is visible", async ({ page }) => {
  test.setTimeout(120_000);
  await resetData(page, "Demo week: mid-week (Day 4)");
  let who = "";
  const problems: string[] = [];
  for (const [person, url] of PAGES) {
    if (person !== who) {
      await signInAs(page, person);
      who = person;
    }
    await open(page, url);
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring = el.querySelector(".chart-mark-ring");
        const ringStroke = ring ? getComputedStyle(ring).stroke : "";
        const visible =
          (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
          (cs.boxShadow !== "" && cs.boxShadow !== "none") ||
          (!!ring && ringStroke !== "transparent" && ringStroke !== "rgba(0, 0, 0, 0)");
        const b = el.getBoundingClientRect();
        const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 50);
        return { visible, sized: b.width > 0 && b.height > 0, label: `${el.tagName} "${label}"` };
      });
      if (!r) continue;
      if (!r.visible) problems.push(`${url}: ${r.label} shows no focus`);
      if (!r.sized) problems.push(`${url}: ${r.label} has no size`);
    }
  }
  expect([...new Set(problems)]).toEqual([]);
});
