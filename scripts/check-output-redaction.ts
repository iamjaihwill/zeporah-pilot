/**
 * Complete-output check for threat T19 (docs/architecture/threat-model.md): what someone types
 * never appears in anything the server process writes or the browser console shows.
 *
 *   bun scripts/check-output-redaction.ts                 # development server, agent detection as found
 *   bun scripts/check-output-redaction.ts --server prod   # local production build (vite build + preview)
 *   bun scripts/check-output-redaction.ts --agent off     # without the variables that make Vite forward
 *                                                         # browser errors to the terminal
 *   bun scripts/check-output-redaction.ts --self-test     # plant a marker in the browser console and
 *                                                         # require the check to catch it
 *   bun scripts/check-output-redaction.ts --self-test server
 *                                                         # negative control: the server process itself
 *                                                         # writes two markers to its stdout and stderr
 *                                                         # (scripts/redaction-self-test-preload.ts),
 *                                                         # and the check must catch both
 *
 * Synthetic only. It starts its own server on its own port with its own database
 * (.data/redaction-<mode>-pglite) and never touches .data/pglite or a running server. The two
 * accounts it signs in with (Daniel, family; Maya, care team) get generated passwords in that
 * throwaway database only.
 *
 * Every scenario carries a unique marker. The check fails if a scenario's failure path wasn't
 * exercised, if the safe diagnostic event is missing, or if a marker appears where it mustn't:
 * the server's stdout or stderr, the browser console or page errors, or (for markers that are
 * never stored) any table. Where a marker legitimately ends up (the message Daniel sent, in the
 * messages table and on his screen) is reported, not failed.
 *
 * Known gaps (KNOWN_GAPS) are reported apart and don't fail the run; one that stops reproducing
 * does, so the evidence gets updated: see docs/readiness/evidence/logging-paths-2026-10-29.md.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Request } from "@playwright/test";
import { sql } from "drizzle-orm";
import { toJSON } from "seroval";
import { openDb } from "../src/server/db/client";
import { seed } from "../src/server/db/seed";
import { hashPassword, hashToken, newToken } from "../src/server/auth/crypto";
import * as s from "../src/server/db/schema";
import { FAMILY_ON_STAFF_PAGE, SIGN_IN_FAILED, STAFF_ON_FAMILY_PAGE } from "../src/server/services/auth";
import { RESET_UNUSABLE } from "../src/server/services/password-reset";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const SERVER = arg("server", "dev") as "dev" | "prod";
const AGENT = arg("agent", "as-found") as "as-found" | "off";
const SELF_TEST: "browser" | "server" | null = process.argv.includes("--self-test")
  ? arg("self-test", "browser") === "server"
    ? "server"
    : "browser"
  : null;
const PORT = SERVER === "dev" ? 3210 : 3220;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = `.data/redaction-${SERVER}-pglite`;
const RUN = randomBytes(3).toString("hex");
const mark = (name: string) => `ZPMARK${name}${RUN}`;
const M = {
  sent: mark("SENT"), // a real message: stored and shown to its household, never logged
  crossSite: mark("XSITE"), // typed, then sent as if from another site: refused
  tooLong: mark("LONG"), // a message over the length cap: refused by validation
  unknownFn: mark("UNKNOWNFN"), // in the body of a request to no server function
  email: mark("EMAIL"), // a sign-in email that has no account
  password: mark("PASSWORD"), // a wrong password
  query: mark("QUERY"), // in a page address
  malformed: mark("MALFORMED"), // inside a request body the framework can't read
  badJson: mark("BADJSON"), // a bare word in a body that isn't JSON (known gap, L4)
  // Care-team sessions.
  staffEmail: mark("STAFFEMAIL"), // a care-team sign-in email that has no account
  staffPassword: mark("STAFFPASSWORD"), // a wrong care-team password
  staffEnroll: mark("STAFFENROLL"), // a patient name in an enrollment a care guide may not make
  resetEmail: mark("RESETEMAIL"), // a password-reset request
  resetToken: mark("RESETTOKEN"), // a reset link that was never issued
  resetPassword: mark("RESETPASSWORD"), // a new password sent with that link
  expired: mark("EXPIRED"), // sent with a care-team session that has expired
  unexpected: mark("UNEXPECTED"), // sent while the server's database won't open
  ...(SELF_TEST === "server" ? { selfTestOut: mark("SELFOUT"), selfTestErr: mark("SELFERR") } : {}),
};
const STORED_OK = new Set([M.sent]);
/**
 * Markers known to reach one channel, with the correction that would close the gap. Reported, not
 * failed; failed if they stop appearing there.
 */
const KNOWN_GAPS: Record<string, { channel: string; gap: string }> = {
  badJson: {
    channel: "server stderr",
    gap: 'L4: TanStack Start prints "Server Fn Error!" with Bun\'s JSON parse error, which quotes the first bare word',
  },
};
/** Secrets learnt during the run (the generated passwords, the session tokens): never anywhere. */
const SECRETS: Record<string, string> = {};

/** Vite turns browser-error forwarding on when one of these says an AI agent is running it. */
const AGENT_VARS =
  /^(AI_AGENT|CLAUDECODE|CLAUDE_CODE.*|CURSOR_.*|GEMINI_CLI|CODEX_.*|COPILOT_.*|OPENCODE_CLIENT|REPL_ID|AUGMENT_AGENT|ANTIGRAVITY_AGENT)$/;

const DANIEL = "redaction-check@example.invalid";
const MAYA = "redaction-staff@example.invalid";

/** Seeds the throwaway database and returns the generated passwords and an already-expired token. */
async function prepareDatabase() {
  await rm(DATA_DIR, { recursive: true, force: true });
  const { db, close } = await openDb(DATA_DIR);
  await seed(db, new Date(), "standard");
  const account = async (actorId: string, email: string) => {
    const [actor] = await db
      .select()
      .from(s.actors)
      .where(sql`${s.actors.id} = ${actorId}`);
    const password = randomBytes(18).toString("base64url");
    const [user] = await db
      .insert(s.users)
      .values({
        tenantId: actor!.tenantId,
        actorId: actor!.id,
        email,
        passwordHash: await hashPassword(password),
      } as typeof s.users.$inferInsert)
      .returning();
    return { password, tenantId: actor!.tenantId, userId: user!.id };
  };
  const daniel = await account("fm-daniel", DANIEL);
  const maya = await account("st-maya", MAYA);
  // A care-team session that ended an hour ago, as if Maya had left a tab open overnight.
  const expiredToken = newToken();
  await db.insert(s.sessions).values({
    id: hashToken(expiredToken),
    tenantId: maya.tenantId,
    actorId: "st-maya",
    userId: maya.userId,
    method: "password",
    expiresAt: new Date(Date.now() - 3_600_000),
  } as typeof s.sessions.$inferInsert);
  await close();
  return { danielPassword: daniel.password, mayaPassword: maya.password, expiredToken };
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => (out.stdout += d));
  child.stderr.on("data", (d) => (out.stderr += d));
  const exited = new Promise<number | null>((r) => child.on("exit", r));
  return { child, out, exited };
}

/** The server, as `bun --bun vite dev|preview`; the first one gets the negative control when asked. */
function startServer(env: NodeJS.ProcessEnv, first: boolean) {
  const mode = SERVER === "dev" ? "dev" : "preview";
  const viteArgs = [mode, "--port", String(PORT), "--strictPort"];
  if (SELF_TEST !== "server" || !first) return run("bun", ["--bun", "vite", ...viteArgs], env);
  // `bun --preload` only applies when Vite's own entry file is named.
  return run(
    "bun",
    [
      "--bun",
      "--preload",
      resolve("scripts/redaction-self-test-preload.ts"),
      "node_modules/vite/bin/vite.js",
      ...viteArgs,
    ],
    { ...env, ZPMARK_SELF_TEST_STDOUT: M.selfTestOut, ZPMARK_SELF_TEST_STDERR: M.selfTestErr },
  );
}

async function stopServer(server: ReturnType<typeof run>) {
  server.child.kill("SIGTERM");
  await Promise.race([server.exited, new Promise((r) => setTimeout(r, 5000))]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

async function waitUntilUp(deadline = Date.now() + 120_000) {
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/`)).status < 500) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The server didn't start within two minutes.");
}

async function signIn(page: Page, email: string, password: string, path = "/") {
  await page.goto(`${BASE}${path}`);
  await page.locator("html[data-hydrated]").waitFor();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password", { exact: true }).press("Enter");
}

/**
 * Server-function addresses by name. Development addresses are base64url JSON naming the export;
 * a production build lists its hashed addresses in dist/server/server.js.
 */
async function serverFnIds() {
  const ids: Record<string, string> = {};
  const suffix = /_createServerFn_handler$/;
  if (SERVER === "prod") {
    const built = await readFile("dist/server/server.js", "utf8");
    for (const [, id, name] of built.matchAll(/"([0-9a-f]{64})": \{\s*functionName: "(\w+)"/g))
      ids[name!.replace(suffix, "")] = id!;
    return ids;
  }
  for (const file of ["session", "staff"]) {
    const code = await (await fetch(`${BASE}/src/functions/${file}.ts`)).text();
    for (const [, id] of code.matchAll(/createClientRpc\(\s*["']([^"']+)["']/g)) {
      const { export: exported } = JSON.parse(Buffer.from(id!, "base64url").toString("utf8")) as {
        export: string;
      };
      ids[exported.replace(suffix, "")] = id!;
    }
  }
  return ids;
}

async function main() {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (AGENT === "off") for (const k of Object.keys(env)) if (AGENT_VARS.test(k)) delete env[k];
  Object.assign(env, {
    ZEPORAH_DATA_DIR: DATA_DIR,
    ZEPORAH_VITE_CACHE: `.data/redaction-vite-cache`,
    ZEPORAH_NOTICE_TIMER: "off",
  });
  delete env["ZEPORAH_DEV_SIGN_IN"];
  if (SERVER === "prod") {
    env["NODE_ENV"] = "production";
    // The server refuses to open its database in production unless the environment is named.
    env["ZEPORAH_ENVIRONMENT"] = "local-redaction-check";
    const build = run("bun", ["--bun", "vite", "build"], env);
    if ((await build.exited) !== 0) throw new Error(`Build failed:\n${build.out.stderr}`);
  }
  const { danielPassword, mayaPassword, expiredToken } = await prepareDatabase();
  SECRETS["family password"] = danielPassword;
  SECRETS["care-team password"] = mayaPassword;
  SECRETS["expired care-team session token"] = expiredToken;
  const server = startServer(env, true);

  const exercised: Record<string, string> = {};
  const browserOut: string[] = [];
  const responses: { url: string; status: number; body: string }[] = [];
  let ids: Record<string, string> = {};
  /** Calls a server function directly, as the app's own client would, and keeps the reply. */
  const callFn = async (page: Page, name: string, method: "GET" | "POST", data: unknown) => {
    const id = ids[name];
    if (!id) throw new Error(`No address found for the server function ${name}.`);
    const payload = JSON.stringify(toJSON({ data }));
    const headers = { origin: BASE, "x-tsr-serverFn": "true" };
    const r =
      method === "GET"
        ? await page.request.get(`${BASE}/_serverFn/${id}?payload=${encodeURIComponent(payload)}`, {
            headers,
          })
        : await page.request.post(`${BASE}/_serverFn/${id}`, {
            headers: { ...headers, "content-type": "application/json" },
            data: payload,
          });
    const body = await r.text();
    responses.push({ url: name, status: r.status(), body });
    return body;
  };
  const watch = (page: Page) => {
    page.on("console", (m) => browserOut.push(`console.${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => browserOut.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));
    page.on("response", async (r) => {
      if (!r.url().includes("/_serverFn/")) return;
      responses.push({ url: r.url(), status: r.status(), body: await r.text().catch(() => "") });
    });
  };
  let browser: Browser | undefined;
  let mayaToken = "";
  try {
    await waitUntilUp();
    ids = await serverFnIds();
    browser = await chromium.launch();
    const page = await browser.newPage();
    watch(page);

    // 1. A sign-in that doesn't match: refused with the generic message.
    await signIn(page, `${M.email}@example.invalid`, `${M.password}-long-enough`);
    await page.getByText(SIGN_IN_FAILED).first().waitFor();
    exercised["wrong sign-in refused"] = "generic message shown";

    // 2. A real message, stored and shown.
    await signIn(page, DANIEL, danielPassword);
    // A refusal here would look like a wrong password: see the sign-in finding in the evidence.
    await page.waitForURL(/\/family/, { timeout: 30_000 });
    const token = (await page.context().cookies()).find((c) => c.name === "zp_session")?.value;
    if (!token) throw new Error("No session cookie after signing in.");
    SECRETS["family session token"] = token;
    await page.goto(`${BASE}/family/messages`);
    await page.locator("html[data-hydrated]").waitFor();
    let sendRequest: Request | undefined;
    const capture = (r: Request) => {
      if (r.method() === "POST" && r.url().includes("/_serverFn/") && (r.postData() ?? "").includes(M.sent))
        sendRequest = r;
    };
    page.on("request", capture);
    await page.getByLabel(/Message Maya Chen/).fill(M.sent);
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByTestId("live-region").filter({ hasText: "Message sent" }).waitFor();
    page.off("request", capture);
    if (!sendRequest) throw new Error("The message send wasn't seen.");
    exercised["message sent"] = "stored";

    // 3. The same call with a message over the length cap.
    const long = await page.request.post(sendRequest.url(), {
      headers: { ...sendRequest.headers(), origin: BASE },
      data: sendRequest.postData()!.replace(M.sent, `${M.tooLong} ${"x".repeat(20_000)}`),
    });
    const longBody = await long.text();
    responses.push({ url: sendRequest.url(), status: long.status(), body: longBody });
    // The framework answers a validation failure with 200 and a serialized error naming the rule.
    if (!longBody.includes("too_big"))
      throw new Error(`An over-long message wasn't refused by validation (${long.status()}).`);
    exercised["over-long message refused"] = `validation (too_big), HTTP ${long.status()}`;

    // 4. A send re-sent as if from another site.
    await page.route("**/_serverFn/**", (route) =>
      route.request().method() === "POST"
        ? route
            .fetch({ headers: { ...route.request().headers(), origin: "https://attacker.example" } })
            .then((response) => route.fulfill({ response }))
        : route.continue(),
    );
    const refused = page.waitForResponse((r) => r.url().includes("/_serverFn/") && r.status() === 403);
    await page.getByLabel(/Message Maya Chen/).fill(M.crossSite);
    await page.getByRole("button", { name: "Send message" }).click();
    await refused;
    // The page follows the refused send with its own calls (marking the thread seen), which are
    // refused too; one of them surfaces as an uncaught error, which Vite may forward to the terminal.
    const until = Date.now() + 8000;
    while (Date.now() < until && !browserOut.some((l) => l.startsWith("pageerror:")))
      await page.waitForTimeout(250);
    await page.waitForTimeout(1500); // let it reach the terminal
    await page.unroute("**/_serverFn/**");
    exercised["cross-site send refused"] = browserOut.some((l) => l.startsWith("pageerror:"))
      ? "403, then an uncaught refusal in the page"
      : "403";

    // 5. A request to no server function, with a marker in its body.
    const unknown = await page.request.post(`${BASE}/_serverFn/not-a-function`, {
      headers: { origin: BASE },
      data: { note: M.unknownFn },
    });
    responses.push({ url: "unknown", status: unknown.status(), body: await unknown.text() });
    if (unknown.status() !== 500) throw new Error(`Unknown function gave ${unknown.status()}.`);
    exercised["unknown server function"] = "500";

    // 6. A real server function sent a body the framework can't read, with a marker in it. (Playwright
    //    sends this string as a quoted JSON string, so it reaches seroval's decoder, not the JSON parser.)
    const malformed = await page.request.post(sendRequest.url(), {
      headers: { "content-type": "application/json", origin: BASE },
      data: `{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":1,"s":"${M.malformed}"}]` + "}",
    });
    responses.push({ url: "malformed", status: malformed.status(), body: await malformed.text() });
    if (malformed.status() < 400) throw new Error(`A malformed body gave ${malformed.status()}.`);
    exercised["malformed body"] = String(malformed.status());

    // 7. A body that isn't JSON at all, starting with a bare word (known gap, L4).
    const notJson = await page.request.post(sendRequest.url(), {
      headers: { "content-type": "application/json", origin: BASE },
      // As bytes: Playwright sends a string that isn't JSON as a quoted JSON string.
      data: Buffer.from(`${M.badJson} and the rest of what was typed`),
    });
    responses.push({ url: "not JSON", status: notJson.status(), body: await notJson.text() });
    if (notJson.status() < 400) throw new Error(`A body that isn't JSON gave ${notJson.status()}.`);
    exercised["body that isn't JSON"] = String(notJson.status());

    // 8. A marker in a page address.
    await page.goto(`${BASE}/family/messages?q=${M.query}`);
    await page.locator("html[data-hydrated]").waitFor();
    exercised["page address with a query"] = "loaded";

    if (SELF_TEST === "browser") {
      await page.evaluate((m) => console.error(`self-test ${m}`), M.query);
      await page.waitForTimeout(1500);
    }

    // Care-team sessions, in a browser of their own.
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    watch(staff);

    // 9. A care-team sign-in that doesn't match.
    await signIn(
      staff,
      `${M.staffEmail}@example.invalid`,
      `${M.staffPassword}-long-enough`,
      "/staff-sign-in",
    );
    await staff.getByText(SIGN_IN_FAILED).first().waitFor();
    exercised["care-team: wrong sign-in refused"] = "generic message shown";

    // 10. A care-team account on the family page, then a family account on the care-team page.
    await signIn(staff, MAYA, mayaPassword);
    await staff.getByText(STAFF_ON_FAMILY_PAGE).first().waitFor();
    await signIn(staff, DANIEL, danielPassword, "/staff-sign-in");
    await staff.getByText(FAMILY_ON_STAFF_PAGE).first().waitFor();
    exercised["care-team: wrong sign-in page"] = "sent to the right page, both ways";

    // 11. Maya signs in on the care-team page.
    await signIn(staff, MAYA, mayaPassword, "/staff-sign-in");
    await staff.waitForURL(/\/staff(\/|\?|$)/, { timeout: 30_000 });
    mayaToken = (await staffContext.cookies()).find((c) => c.name === "zp_session")?.value ?? "";
    if (!mayaToken) throw new Error("No session cookie after the care-team sign-in.");
    SECRETS["care-team session token"] = mayaToken;
    exercised["care-team: signed in"] = "staff workspace";

    // 12. Authorization failure: a care guide may not enroll a household (the patient's name is
    //     what she typed).
    const enroll = await callFn(staff, "enrollHousehold", "POST", {
      patientName: `${M.staffEnroll} Wells`,
      careGuideActorId: "st-maya",
    });
    if (!enroll.includes("NOT_PERMITTED")) throw new Error("A care guide's enrollment wasn't refused.");
    exercised["care-team: permission refused"] = "NOT_PERMITTED";

    // 13. Recovery. Email reset isn't offered here (no mail channel outside development sign-in,
    //     and care-team accounts are never eligible); every step must still refuse quietly.
    const request = await callFn(staff, "requestPasswordReset", "POST", {
      email: `${M.resetEmail}@example.invalid`,
    });
    const check = await callFn(staff, "checkResetLink", "GET", { token: M.resetToken });
    const complete = await callFn(staff, "completePasswordReset", "POST", {
      token: M.resetToken,
      password: `${M.resetPassword}-long-enough`,
    });
    if (!request.includes("isn't available here")) throw new Error("A reset request wasn't refused.");
    if (!check.includes(RESET_UNUSABLE))
      throw new Error("A reset link that was never issued wasn't refused.");
    if (!complete.includes("isn't available here")) throw new Error("A reset completion wasn't refused.");
    exercised["care-team: recovery refused"] = "request, link check and completion";

    // 14. Expiry: a care-team session that ended an hour ago.
    const expiredContext = await browser.newContext();
    await expiredContext.addCookies([{ name: "zp_session", value: expiredToken, url: BASE }]);
    const expired = await expiredContext.newPage();
    watch(expired);
    await expired.goto(`${BASE}/staff`);
    await expired.waitForURL(/staff-sign-in/, { timeout: 30_000 });
    const afterExpiry = await callFn(expired, "enrollHousehold", "POST", {
      patientName: `${M.expired} Wells`,
      careGuideActorId: "st-maya",
    });
    if (!afterExpiry.includes("NOT_AUTHENTICATED")) throw new Error("An expired session wasn't refused.");
    exercised["care-team: expired session"] = "sent to sign in; call refused NOT_AUTHENTICATED";
    await expiredContext.close();
    await staffContext.close();
    await browser.close();
  } catch (e) {
    // Keep what the server said, then fail: a scenario that didn't run proves nothing.
    await browser?.close();
    await stopServer(server);
    await mkdir(".data", { recursive: true });
    await writeFile(
      `.data/redaction-${SERVER}-${AGENT}-failed.txt`,
      `${server.out.stdout}\n---\n${server.out.stderr}`,
    );
    throw e;
  }
  await stopServer(server);

  // 15–16. Unexpected errors, on a second server whose database won't open: in production, the
  // environment isn't named (correction L2); in development, the data folder is a file. Daniel's
  // sign-in must look like any refused sign-in and be reported (L2); Maya's call, with her session
  // still in the cookie, must get the reference reply, and that reference must be the one logged.
  const unopenable = { ...env };
  if (SERVER === "prod") delete unopenable["ZEPORAH_ENVIRONMENT"];
  else {
    unopenable["ZEPORAH_DATA_DIR"] = `.data/redaction-dev-not-a-folder`;
    await writeFile(unopenable["ZEPORAH_DATA_DIR"], "Not a database folder (synthetic check).\n");
  }
  const second = startServer(unopenable, false);
  let reference = "";
  try {
    await waitUntilUp();
    browser = await chromium.launch();
    const page = await browser.newPage();
    watch(page);
    await signIn(page, DANIEL, danielPassword);
    await page.getByText(SIGN_IN_FAILED).first().waitFor();
    exercised["sign-in with the database refused"] = "generic message";
    await page.context().addCookies([{ name: "zp_session", value: mayaToken, url: BASE }]);
    const body = await callFn(page, "enrollHousehold", "POST", {
      patientName: `${M.unexpected} Wells`,
      careGuideActorId: "st-maya",
    });
    reference = /share this reference: ([0-9A-F]{8})/.exec(body)?.[1] ?? "";
    if (!reference) throw new Error("A care-team call with the database refused got no reference.");
    exercised["care-team: unexpected error"] = `reference ${reference} shown`;
    await browser.close();
    await new Promise((r) => setTimeout(r, 500));
  } catch (e) {
    await browser?.close();
    await stopServer(second);
    await writeFile(
      `.data/redaction-${SERVER}-${AGENT}-failed.txt`,
      `${second.out.stdout}\n---\n${second.out.stderr}`,
    );
    throw e;
  }
  await stopServer(second);

  // Where every marker ended up.
  const channels: Record<string, string> = {
    "server stdout": server.out.stdout,
    "server stderr": server.out.stderr,
    "second server stdout": second.out.stdout,
    "second server stderr": second.out.stderr,
    "browser console and page errors": browserOut.join("\n"),
  };
  const { db, close } = await openDb(DATA_DIR);
  const tables = (await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  )) as unknown as { rows: { table_name: string }[] };
  const tableText: Record<string, string[]> = {};
  for (const { table_name } of tables.rows) {
    const rows = (await db.execute(sql.raw(`select t::text as r from "${table_name}" t`))) as unknown as {
      rows: { r: string }[];
    };
    tableText[table_name] = rows.rows.map((x) => x.r);
  }
  await close();

  // Keep the complete captured output for review (git-ignored, synthetic only).
  const outDir = `.data/redaction-${SERVER}-${AGENT}${SELF_TEST ? `-self-test-${SELF_TEST}` : ""}-output`;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const [c, text] of Object.entries(channels))
    await writeFile(`${outDir}/${c.replace(/\W+/g, "-")}.txt`, text);
  await writeFile(`${outDir}/responses.json`, JSON.stringify(responses, null, 2));

  const problems: string[] = [];
  const knownGaps: string[] = [];
  const found: Record<string, string[]> = {};
  for (const [name, marker] of Object.entries(M) as [string, string][]) {
    const where = Object.entries(channels)
      .filter(([, text]) => text.includes(marker))
      .map(([c]) => c);
    const known = KNOWN_GAPS[name];
    for (const c of where)
      if (known?.channel === c) knownGaps.push(`"${name}" marker in ${c} (${known.gap})`);
      else problems.push(`"${name}" marker in ${c}`);
    if (known && !where.includes(known.channel))
      problems.push(
        `known gap "${name}" no longer reproduces in ${known.channel}: update the check and the evidence`,
      );
    const respHits = responses.filter((r) => r.body.includes(marker)).map((r) => `response ${r.status}`);
    const tableHits = Object.keys(tableText).filter((t) => tableText[t]!.some((r) => r.includes(marker)));
    if (!STORED_OK.has(marker)) for (const t of tableHits) problems.push(`"${name}" marker stored in ${t}`);
    found[name] = [...where, ...respHits, ...tableHits.map((t) => `table ${t}`)];
  }
  for (const [name, secret] of Object.entries(SECRETS)) {
    for (const [c, text] of Object.entries(channels))
      if (text.includes(secret)) problems.push(`${name} in ${c}`);
    for (const r of responses) if (r.body.includes(secret)) problems.push(`${name} in a response body`);
    for (const [t, rows] of Object.entries(tableText))
      if (rows.some((r) => r.includes(secret))) problems.push(`${name} stored in ${t}`);
  }

  // The safe diagnostic events: structured lines with a reference, on each server.
  const structured = (out: { stdout: string; stderr: string }) =>
    `${out.stderr}\n${out.stdout}`
      .split("\n")
      .map((l) => l.slice(l.indexOf("{")))
      .filter((l) => l.startsWith('{"level":"error"') && l.includes('"ref"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  const firstLines = structured(server.out);
  const secondLines = structured(second.out);
  // The unknown function's failure on the first server.
  if (!firstLines.length) problems.push("no structured error line (the safe diagnostic event) was written");
  // L2 (sign-in) and the care-team call on the second server, the latter under the reference shown.
  if (secondLines.length < 2)
    problems.push(`the server whose database won't open wrote ${secondLines.length} structured lines, not 2`);
  if (reference && !secondLines.some((l) => l["ref"] === reference))
    problems.push(`reference ${reference} was shown but not logged`);

  const report = {
    server: SERVER,
    selfTest: SELF_TEST,
    agentVariables:
      AGENT === "off"
        ? "removed"
        : Object.keys(process.env).filter((k) => AGENT_VARS.test(k)).length > 0
          ? "present"
          : "absent",
    exercised,
    markersFoundIn: found,
    secretsChecked: Object.keys(SECRETS),
    diagnosticEvents: { first: firstLines, second: secondLines },
    capturedLines: Object.fromEntries(Object.entries(channels).map(([c, x]) => [c, x.split("\n").length])),
    output: outDir,
    knownGaps,
    problems,
  };
  console.log(JSON.stringify(report, null, 2));
  if (SELF_TEST) {
    // Browser: the planted marker must be caught in the browser console, and nowhere else (with
    // console forwarding off, correction L3, it never reaches the server's output). Server: both
    // markers the server wrote itself must be caught, each in its own channel, and nothing else.
    const planted =
      SELF_TEST === "browser"
        ? ['"query" marker in browser console and page errors']
        : ['"selfTestOut" marker in server stdout', '"selfTestErr" marker in server stderr'];
    const caught = planted.every((p) => problems.includes(p));
    const others = problems.filter((p) => !planted.includes(p));
    const passed = caught && !others.length;
    console.log(passed ? "Self-test: the planted markers were caught." : "Self-test FAILED.");
    process.exit(passed ? 0 : 1);
  }
  process.exit(problems.length ? 1 : 0);
}

await main();
