import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ready } from "../e2e/helpers";

/**
 * Design-review verification. Read-only: it signs in and looks, never changes data.
 * Automated checks only — not a substitute for a manual accessibility review.
 */
const PERSONAS = [
  "Daniel Okafor",
  "Ada Okafor",
  "Chidi Okafor",
  "Maya Chen",
  "Dana Brooks",
  "Priya Raman",
  "Lena Hoffman",
  "Jordan Ellis",
];
const WIDTHS = [390, 768, 1024, 1280, 1338];
const DETAIL: Record<string, string[]> = {
  "Maya Chen": ["/staff/households/hh-okafor", "/staff/packets/pk-okafor-respite"],
  "Dana Brooks": [
    "/staff/households/hh-okafor",
    "/staff/packets/pk-okafor-respite",
    "/staff/households/hh-lindqvist",
  ],
  "Jordan Ellis": ["/staff/households/chh-moss"],
};
const WILLOW_HOUSEHOLDS = ["Rivera", "Okafor", "Bennett", "Patel", "Nguyen", "Hart", "Lindqvist"];

function guard(page: Page) {
  const errors: string[] = [];
  page.on(
    "console",
    (m) => m.type() === "error" && errors.push(`${page.url()} console: ${m.text().slice(0, 200)}`),
  );
  page.on("pageerror", (e) => errors.push(`${page.url()} pageerror: ${e.message.slice(0, 200)}`));
  return errors;
}

async function signIn(page: Page, name: string) {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await page.waitForURL(/\/(family|staff|staff\/admin)$/);
  await ready(page);
}

async function navHrefs(page: Page) {
  await expect(page.getByRole("navigation", { name: "Main" }).locator("a[href]").first()).toBeVisible();
  await expect(page.locator("main h1").first()).toBeVisible();
  const hrefs = await page
    .getByRole("navigation", { name: "Main" })
    .locator("a[href]")
    .evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
  return [...new Set(hrefs)];
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return r.violations.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.nodes
        .map((n) => n.target.join(" "))
        .slice(0, 3)
        .join(" | ")}`,
  );
}

for (const persona of PERSONAS) {
  test(`sweep: ${persona}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1338, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errors = guard(page);
    await signIn(page, persona);
    const pages = await navHrefs(page);
    expect(pages.length, "nav pages found").toBeGreaterThan(3);
    // Detail pages reached from the nav, where they hold the widest tables.
    pages.push(...(DETAIL[persona] ?? []));
    const problems: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      for (const path of pages) {
        await page.goto(path);
        await ready(page);
        await expect(page.locator("main h1").first()).toBeVisible();
        const over = await overflow(page);
        if (over > 0) problems.push(`${width}px ${path}: ${over}px sideways overflow`);
        if (persona === "Jordan Ellis") {
          const text = await page.locator("body").innerText();
          for (const h of WILLOW_HOUSEHOLDS)
            if (new RegExp(`\\b${h}\\b`).test(text)) problems.push(`${path}: Jordan sees ${h}`);
          if (/Willow Creek/.test(text)) problems.push(`${path}: Jordan sees "Willow Creek"`);
        }
      }
    }
    console.log(`${persona}: ${pages.length} pages × ${WIDTHS.length} widths — ${pages.join(", ")}`);
    expect([...problems, ...errors]).toEqual([]);
    await ctx.close();
  });
}

test("Jordan is denied Willow Creek records by direct URL", async ({ page }) => {
  await signIn(page, "Jordan Ellis");
  for (const path of [
    "/staff/households/hh-okafor",
    "/staff/households/hh-rivera",
    "/staff/packets/pk-okafor-respite",
  ]) {
    await page.goto(path);
    await ready(page);
    await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
    await expect(page.getByText("Okafor")).toHaveCount(0);
  }
});

const AXE_PAGES: [string | null, string][] = [
  [null, "/"],
  ["Daniel Okafor", "/family"],
  ["Daniel Okafor", "/family/messages"],
  ["Ada Okafor", "/family/sharing"],
  ["Dana Brooks", "/staff"],
  ["Dana Brooks", "/staff/exceptions"],
  ["Dana Brooks", "/staff/packets/pk-okafor-respite"],
];
for (const width of [390, 1338]) {
  test(`axe at ${width}px`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const found: string[] = [];
    for (const [persona, path] of AXE_PAGES) {
      if (persona) await signIn(page, persona);
      await page.goto(path);
      await ready(page);
      for (const v of await axe(page)) found.push(`${path} (${persona ?? "signed out"}): ${v}`);
      if (persona) await ctx.clearCookies();
    }
    expect(found).toEqual([]);
    await ctx.close();
  });
}

async function tabOrder(page: Page, steps: number) {
  const seen: string[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return "(body)";
        const name =
          el.getAttribute("aria-label") ||
          el.innerText?.trim().split("\n")[0] ||
          (el as HTMLInputElement).name ||
          el.id;
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const ring = style.outlineStyle !== "none" || style.boxShadow !== "none";
        const onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
        return `${el.tagName.toLowerCase()} "${name.slice(0, 40)}"${ring ? "" : " [NO FOCUS STYLE]"}${onScreen ? "" : " [OFF SCREEN]"}`;
      }),
    );
  }
  return seen;
}

test("keyboard: sign-in page", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  const order = await tabOrder(page, 14);
  console.log("sign-in tab order:\n  " + order.join("\n  "));
  const at = (re: RegExp) => order.findIndex((s) => re.test(s));
  expect(at(/input "?email/i) >= 0 || order.some((s) => /input/.test(s))).toBe(true);
  expect(order.filter((s) => /NO FOCUS STYLE|OFF SCREEN/.test(s))).toEqual([]);
});

test("keyboard: family bottom bar on a phone", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await signIn(page, "Daniel Okafor");
  await page.locator("[data-bottom-bar] a, [data-bottom-bar] button").first().focus();
  const order = [await page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim())];
  for (const s of await tabOrder(page, 4)) order.push(s);
  console.log("bottom bar tab order:\n  " + order.join("\n  "));
  expect(order.filter((s) => /NO FOCUS STYLE/.test(s))).toEqual([]);
  // More opens a dialog that takes focus and closes with Escape, returning focus.
  const more = page.locator("[data-bottom-bar]").getByRole("button", { name: /^More/ });
  await more.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "More" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
  await ctx.close();
});

test("keyboard: queue filters", async ({ page }) => {
  await page.setViewportSize({ width: 1338, height: 900 });
  await signIn(page, "Dana Brooks");
  await page.goto("/staff/exceptions");
  await ready(page);
  // The view tabs, then the filter row (staff rework, section 3).
  await page.getByRole("navigation", { name: "Exception views" }).getByRole("link").first().focus();
  const order = await tabOrder(page, 12);
  console.log("queue view and filter tab order:\n  " + order.join("\n  "));
  expect(order.filter((s) => /NO FOCUS STYLE|OFF SCREEN/.test(s))).toEqual([]);
  // A view chosen by keyboard changes the list and says so.
  await page
    .getByRole("navigation", { name: "Exception views" })
    .getByRole("link", { name: /^No owner/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/view=unowned/);
  await expect(
    page.getByRole("navigation", { name: "Exception views" }).getByRole("link", { name: /^No owner/ }),
  ).toHaveAttribute("aria-current", "page");
  // A filter set by keyboard goes into the URL.
  await page.getByRole("combobox", { name: "Owner", exact: true }).focus();
  await page.getByRole("combobox", { name: "Owner", exact: true }).selectOption("mine");
  await expect(page).toHaveURL(/who=mine/);
});

test("after screenshots", async ({ browser, baseURL }) => {
  const out = "docs/review-screenshots/after";
  const shot = async (persona: string, width: number, height: number, list: [string, string, boolean][]) => {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await signIn(page, persona);
    for (const [path, name, full] of list) {
      await page.goto(baseURL + path);
      await ready(page);
      await page.waitForTimeout(400);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
      console.log(name, "scrollWidth/innerWidth", sw.join("/"));
    }
    await ctx.close();
  };
  await shot("Maya Chen", 1338, 900, [["/staff", "item1-staff-dashboard-maya-1338", false]]);
  await shot("Dana Brooks", 1338, 900, [
    ["/staff", "item11-staff-dashboard-dana-1338", true],
    ["/staff/exceptions", "item11-staff-queue-dana-1338", true],
    ["/staff/packets", "item15-packets-dana-1338", true],
  ]);
  await shot("Daniel Okafor", 390, 844, [["/family", "item3-family-home-daniel-390", false]]);
  await shot("Ada Okafor", 1280, 900, [["/family/sharing", "item7-sharing-ada-1280", true]]);
});
