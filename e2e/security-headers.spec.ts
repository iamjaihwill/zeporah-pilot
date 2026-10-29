import type { APIResponse } from "@playwright/test";
import { securityHeaders } from "../src/domain/security-headers";
import { expect, test } from "./fixtures";
import { signInAs } from "./helpers";

/**
 * PB-05 evidence: the header baseline (src/domain/security-headers.ts) is on every type of response
 * the server gives, including refusals, redirects, errors and static files, and HSTS appears only
 * when the request arrived over https. The development server sets the static-file headers itself
 * (vite.config.ts); in production that's the edge's job, which this can't test.
 */

const PLAIN = securityHeaders({ https: false });
const HTTPS = securityHeaders({ https: true });

function expectBaseline(res: APIResponse, label: string, expected = PLAIN) {
  const h = res.headers();
  for (const [name, value] of Object.entries(expected))
    expect(h[name.toLowerCase()], `${label}: ${name}`).toBe(value);
  if (!("Strict-Transport-Security" in expected))
    expect(h["strict-transport-security"], `${label}: no HSTS over http`).toBeUndefined();
}

test("every type of response carries the header baseline", async ({ page }) => {
  const anon = page.request;
  const cases: [string, () => Promise<APIResponse>, number | RegExp][] = [
    ["sign-in page", () => anon.get("/"), 200],
    ["staff sign-in page", () => anon.get("/staff-sign-in"), /^(200|30\d)$/],
    ["signed-out redirect", () => anon.get("/staff/queue", { maxRedirects: 0 }), /^30\d$/],
    ["unknown page", () => anon.get("/no-such-page"), 404],
    ["static image", () => anon.get("/images/sign-in-couple.jpg"), 200],
    ["client module", () => anon.get("/src/domain/labels.ts"), 200],
    [
      "cross-site refusal",
      () =>
        anon.post("/_serverFn/x", {
          headers: { Origin: "https://attacker.example" },
          data: {},
        }),
      403,
    ],
  ];
  for (const [label, call, status] of cases) {
    const res = await call();
    const code = String(res.status());
    if (typeof status === "number") expect(code, label).toBe(String(status));
    else expect(code, label).toMatch(status);
    expectBaseline(res, label);
  }

  // Signed in: a family page, a staff page and a server function response.
  await signInAs(page, "Daniel Okafor");
  expectBaseline(await page.request.get("/family"), "family page");
  await signInAs(page, "Dana Brooks");
  expectBaseline(await page.request.get("/staff/queue"), "staff page");
  const fnResponse = page.waitForResponse((r) => r.url().includes("/_serverFn/"));
  await page.reload();
  const fn = await fnResponse;
  const h = await fn.allHeaders();
  for (const [name, value] of Object.entries(PLAIN))
    expect(h[name.toLowerCase()], `server function: ${name}`).toBe(value);
});

test("HSTS is added when the request arrived over https, and only then", async ({ page }) => {
  const res = await page.request.get("/", { headers: { "X-Forwarded-Proto": "https" } });
  expectBaseline(res, "https sign-in page", HTTPS);
  const refusal = await page.request.post("/_serverFn/x", {
    headers: { Origin: "https://attacker.example", "X-Forwarded-Proto": "https" },
    data: {},
  });
  expect(refusal.status()).toBe(403);
  expectBaseline(refusal, "https refusal", HTTPS);
});

/**
 * Known gap, found 2026-10-29: an error the framework raises before the app's handlers run (here,
 * an unknown server function address) escapes the header middleware in src/start.ts, so its 500
 * reply has no baseline headers. Marked as expected to fail so it reports when fixed. The fix (a
 * catch around `next()` in src/start.ts) changes the demo build's behaviour and waits for a lift.
 */
test("a framework error before any handler still carries the baseline (known gap)", async ({ page }) => {
  test.fail();
  const res = await page.request.post("/_serverFn/not-a-function", { data: {} });
  expect(res.status()).toBe(500);
  expectBaseline(res, "framework error");
});
