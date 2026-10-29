import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect } from "@playwright/test";
import { nav, resetData, signInAs } from "./helpers";

/**
 * PB-06 evidence: every server function that can change something refuses a request from another
 * site, before its handler runs (src/start.ts, src/domain/same-origin.ts).
 *
 * The list comes from the source, so a new server function is covered without editing this file:
 * each `export const X = createServerFn({ method: "POST" })` in src/functions. Its address is the
 * one the development server gives the browser for that function. Every request carries a signed-in
 * operations session, so a refusal can't be put down to a missing sign-in.
 */

const FUNCTIONS_DIR = join(process.cwd(), "src/functions");
const DECLARATION = /export const (\w+) = createServerFn\(\{ method: "(GET|POST)" \}\)/g;
const REFUSAL = "This change has to come from Zeporah itself. Nothing was changed.";

/**
 * The shared console guard (fixtures.ts), with one addition: when the page's own send is refused
 * (the last test), the client reports the refusal as an uncaught error carrying the refusal text.
 * That line only is allowed; anything else still fails. It's recorded as a finding (the composer
 * should show its error state instead) in docs/readiness/evidence/security-evidence-2026-10-29.md.
 */
const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (
          m.type() === "error" &&
          !/^Failed to load resource: the server responded with a status of (4\d\d|503)/.test(m.text())
        )
          problems.push(`console.error: ${m.text().slice(0, 300)}`);
      });
      page.on("pageerror", (e) => {
        if (e.message !== REFUSAL) problems.push(`page error: ${e.message.slice(0, 300)}`);
      });
      await use();
      expect(problems, "browser reported errors during this test").toEqual([]);
    },
    { auto: true },
  ],
});

type ServerFn = { file: string; name: string; method: "GET" | "POST" };

function declaredServerFns(): ServerFn[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .flatMap((file) =>
      [...readFileSync(join(FUNCTIONS_DIR, file), "utf8").matchAll(DECLARATION)].map((m) => ({
        file,
        name: m[1]!,
        method: m[2] as "GET" | "POST",
      })),
    );
}

/** The ids the development server's client modules call, by exported name. */
async function serverFnIds(request: import("@playwright/test").APIRequestContext, file: string) {
  const code = await (await request.get(`/src/functions/${file}`)).text();
  const ids = new Map<string, string>();
  for (const [, id] of code.matchAll(/createClientRpc\(\s*["']([^"']+)["']/g)) {
    // Development ids are base64url JSON naming the export ("<name>_createServerFn_handler").
    const { export: exported } = JSON.parse(Buffer.from(id!, "base64url").toString("utf8")) as {
      export: string;
    };
    ids.set(exported.replace(/_createServerFn_handler(_\d+)?$/, ""), id!);
  }
  return ids;
}

const ATTACKS: { label: string; headers: Record<string, string> }[] = [
  { label: "a foreign Origin", headers: { Origin: "https://attacker.example" } },
  { label: "the opaque null Origin", headers: { Origin: "null" } },
  { label: "a sibling subdomain", headers: { Origin: "http://app.localhost:3100" } },
  { label: "Sec-Fetch-Site: cross-site without Origin", headers: { "Sec-Fetch-Site": "cross-site" } },
  { label: "Sec-Fetch-Site: same-site without Origin", headers: { "Sec-Fetch-Site": "same-site" } },
];

test.beforeEach(async ({ page }) => resetData(page));

test("every state-changing server function refuses a request from another site", async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, "Dana Brooks");
  const all = declaredServerFns();
  const posts = all.filter((f) => f.method === "POST");
  // A floor, so a broken pattern can't pass by finding nothing (124 on 2026-10-29).
  expect(posts.length).toBeGreaterThanOrEqual(120);

  const unmatched: string[] = [];
  const notRefused: string[] = [];
  for (const file of [...new Set(posts.map((f) => f.file))]) {
    const ids = await serverFnIds(page.request, file);
    for (const fn of posts.filter((f) => f.file === file)) {
      const id = ids.get(fn.name);
      if (!id) {
        unmatched.push(`${file}:${fn.name}`);
        continue;
      }
      for (const attack of ATTACKS) {
        const res = await page.request.post(`/_serverFn/${id}`, {
          headers: { "Content-Type": "application/json", ...attack.headers },
          data: {},
        });
        const body = res.status() === 403 ? ((await res.json()) as { error?: string }) : {};
        if (res.status() !== 403 || body.error !== REFUSAL)
          notRefused.push(`${fn.name} with ${attack.label}: ${res.status()}`);
      }
    }
  }
  expect(unmatched, "server functions with no address on the development server").toEqual([]);
  expect(notRefused, "state-changing server functions not refused cross-site").toEqual([]);
});

test("the same function from Zeporah itself isn't refused by the check", async ({ page }) => {
  // The control: same address, same session, this server's own Origin. It may fail validation (the
  // body is empty), but it gets past the cross-site check.
  await signInAs(page, "Dana Brooks");
  const ids = await serverFnIds(page.request, "staff-shell.ts");
  const id = ids.get("saveQueueView");
  expect(id).toBeTruthy();
  const res = await page.request.post(`/_serverFn/${id}`, {
    headers: { "Content-Type": "application/json", Origin: new URL(page.url()).origin },
    data: {},
  });
  expect(res.status()).not.toBe(403);
});

test("a real message sent with a foreign Origin is refused and never arrives", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await nav(page, "Updates & messages").click();
  // The page's own send, with a real payload and session, re-sent as if another site sent it.
  // route.continue() can't replace the browser's Origin header, so the request is fetched anew.
  await page.route("**/_serverFn/**", (route) =>
    route.request().method() === "POST"
      ? route
          .fetch({ headers: { ...route.request().headers(), origin: "https://attacker.example" } })
          .then((response) => route.fulfill({ response }))
      : route.continue(),
  );
  const text = "Cross-site test message that must never arrive";
  await page.getByLabel(/Message Maya Chen/).fill(text);
  const refused = page.waitForResponse(
    (r) => r.url().includes("/_serverFn/") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  expect((await refused).status()).toBe(403);
  await expect(page.getByTestId("live-region")).not.toHaveText("Message sent to your care guide.");
  await page.unroute("**/_serverFn/**");

  // The care guide's view of the thread doesn't have it.
  await signInAs(page, "Maya Chen");
  await page.goto("/staff/households/hh-okafor?tab=messages");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.getByText(text)).toHaveCount(0);
});

test("reads aren't refused, and GET server functions stay readable from Zeporah", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  const gets = declaredServerFns().filter((f) => f.method === "GET");
  expect(gets.length).toBeGreaterThanOrEqual(70);
  const res = await page.request.get("/staff/queue", { headers: { "Sec-Fetch-Site": "cross-site" } });
  // A navigation from another site to a page is allowed (a link in an email); only changes are refused.
  expect(res.status()).toBe(200);
});
