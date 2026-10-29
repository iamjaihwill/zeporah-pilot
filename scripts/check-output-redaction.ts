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
 *
 * Synthetic only. It starts its own server on its own port with its own database
 * (.data/redaction-<mode>-pglite) and never touches .data/pglite or a running server. The one
 * account it signs in with gets a generated password in that throwaway database only.
 *
 * Every scenario carries a unique marker. The check fails if a scenario's failure path wasn't
 * exercised, if the safe diagnostic event is missing, or if a marker appears where it mustn't:
 * the server's stdout or stderr, the browser console or page errors, or (for markers that are
 * never stored) any table. Where a marker legitimately ends up (the message Daniel sent, in the
 * messages table and on his screen) is reported, not failed.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { chromium, type Page, type Request } from "@playwright/test";
import { sql } from "drizzle-orm";
import { openDb } from "../src/server/db/client";
import { seed } from "../src/server/db/seed";
import { hashPassword } from "../src/server/auth/crypto";
import * as s from "../src/server/db/schema";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const SERVER = arg("server", "dev") as "dev" | "prod";
const AGENT = arg("agent", "as-found") as "as-found" | "off";
const SELF_TEST = process.argv.includes("--self-test");
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
};
const STORED_OK = new Set([M.sent]);
/** Secrets learnt during the run (the generated password, the session token): never anywhere. */
const SECRETS: Record<string, string> = {};

/** Vite turns browser-error forwarding on when one of these says an AI agent is running it. */
const AGENT_VARS =
  /^(AI_AGENT|CLAUDECODE|CLAUDE_CODE.*|CURSOR_.*|GEMINI_CLI|CODEX_.*|COPILOT_.*|OPENCODE_CLIENT|REPL_ID|AUGMENT_AGENT|ANTIGRAVITY_AGENT)$/;

async function prepareDatabase() {
  await rm(DATA_DIR, { recursive: true, force: true });
  const { db, close } = await openDb(DATA_DIR);
  await seed(db, new Date(), "standard");
  const [daniel] = await db
    .select()
    .from(s.actors)
    .where(sql`${s.actors.id} = 'fm-daniel'`);
  const password = randomBytes(18).toString("base64url");
  await db.insert(s.users).values({
    tenantId: daniel!.tenantId,
    actorId: daniel!.id,
    email: "redaction-check@example.invalid",
    passwordHash: await hashPassword(password),
  } as typeof s.users.$inferInsert);
  await close();
  return password;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => (out.stdout += d));
  child.stderr.on("data", (d) => (out.stderr += d));
  const exited = new Promise<number | null>((r) => child.on("exit", r));
  return { child, out, exited };
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

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/`);
  await page.locator("html[data-hydrated]").waitFor();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password", { exact: true }).press("Enter");
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
  const password = await prepareDatabase();
  const server =
    SERVER === "dev"
      ? run("bun", ["--bun", "vite", "dev", "--port", String(PORT), "--strictPort"], env)
      : run("bun", ["--bun", "vite", "preview", "--port", String(PORT), "--strictPort"], env);

  const stop = async () => {
    server.child.kill("SIGTERM");
    await Promise.race([server.exited, new Promise((r) => setTimeout(r, 5000))]);
    if (server.child.exitCode === null) server.child.kill("SIGKILL");
  };
  const exercised: Record<string, string> = {};
  const browserOut: string[] = [];
  const responses: { url: string; status: number; body: string }[] = [];
  try {
    await waitUntilUp();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on("console", (m) => browserOut.push(`console.${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => browserOut.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));
    page.on("response", async (r) => {
      if (!r.url().includes("/_serverFn/")) return;
      responses.push({ url: r.url(), status: r.status(), body: await r.text().catch(() => "") });
    });

    // 1. A sign-in that doesn't match: refused with the generic message.
    await signIn(page, `${M.email}@example.invalid`, `${M.password}-long-enough`);
    await page.getByText("That email and password didn't work").first().waitFor();
    exercised["wrong sign-in refused"] = "generic message shown";

    // 2. A real message, stored and shown.
    await signIn(page, "redaction-check@example.invalid", password);
    // A refusal here would look like a wrong password: see the sign-in finding in the evidence.
    await page.waitForURL(/\/family/, { timeout: 30_000 });
    SECRETS["password"] = password;
    const token = (await page.context().cookies()).find((c) => c.name === "zp_session")?.value;
    if (!token) throw new Error("No session cookie after signing in.");
    SECRETS["session token"] = token;
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

    // 6. A real server function sent a body the framework can't read, with a marker in it.
    const malformed = await page.request.post(sendRequest.url(), {
      headers: { "content-type": "application/json", origin: BASE },
      data: `{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":1,"s":"${M.malformed}"}]` + "}",
    });
    responses.push({ url: "malformed", status: malformed.status(), body: await malformed.text() });
    if (malformed.status() < 400) throw new Error(`A malformed body gave ${malformed.status()}.`);
    exercised["malformed body"] = String(malformed.status());

    // 7. A marker in a page address.
    await page.goto(`${BASE}/family/messages?q=${M.query}`);
    await page.locator("html[data-hydrated]").waitFor();
    exercised["page address with a query"] = "loaded";

    if (SELF_TEST) {
      await page.evaluate((m) => console.error(`self-test ${m}`), M.query);
      await page.waitForTimeout(1500);
    }
    await browser.close();
  } catch (e) {
    // Keep what the server said, then fail: a scenario that didn't run proves nothing.
    await stop();
    await mkdir(".data", { recursive: true });
    await writeFile(
      `.data/redaction-${SERVER}-${AGENT}-failed.txt`,
      `${server.out.stdout}\n---\n${server.out.stderr}`,
    );
    throw e;
  }
  await stop();

  // Where every marker ended up.
  const channels: Record<string, string> = {
    "server stdout": server.out.stdout,
    "server stderr": server.out.stderr,
    "browser console and page errors": browserOut.join("\n"),
  };
  const { db, close } = await openDb(DATA_DIR);
  const tables = (await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  )) as unknown as { rows: { table_name: string }[] };
  const inTables: Record<string, string[]> = {};
  for (const { table_name } of tables.rows) {
    const rows = (await db.execute(sql.raw(`select t::text as r from "${table_name}" t`))) as unknown as {
      rows: { r: string }[];
    };
    for (const marker of Object.values(M))
      if (rows.rows.some((x) => x.r.includes(marker))) (inTables[marker] ??= []).push(table_name);
  }
  await close();

  // Keep the complete captured output for review (git-ignored, synthetic only).
  const outDir = `.data/redaction-${SERVER}-${AGENT}-output`;
  await mkdir(outDir, { recursive: true });
  for (const [c, text] of Object.entries(channels))
    await writeFile(`${outDir}/${c.replace(/\W+/g, "-")}.txt`, text);
  await writeFile(`${outDir}/responses.json`, JSON.stringify(responses, null, 2));

  const problems: string[] = [];
  const found: Record<string, string[]> = {};
  for (const [name, marker] of Object.entries(M)) {
    const where = Object.entries(channels)
      .filter(([, text]) => text.includes(marker))
      .map(([c]) => c);
    for (const c of where) problems.push(`"${name}" marker in ${c}`);
    const respHits = responses.filter((r) => r.body.includes(marker)).map((r) => `response ${r.status}`);
    const tableHits = inTables[marker] ?? [];
    if (!STORED_OK.has(marker)) for (const t of tableHits) problems.push(`"${name}" marker stored in ${t}`);
    found[name] = [...where, ...respHits, ...tableHits.map((t) => `table ${t}`)];
  }
  for (const [name, secret] of Object.entries(SECRETS)) {
    for (const [c, text] of Object.entries(channels))
      if (text.includes(secret)) problems.push(`${name} in ${c}`);
    for (const r of responses) if (r.body.includes(secret)) problems.push(`${name} in a response body`);
    const { db: db2, close: close2 } = await openDb(DATA_DIR);
    for (const { table_name } of tables.rows) {
      const rows = (await db2.execute(sql.raw(`select t::text as r from "${table_name}" t`))) as unknown as {
        rows: { r: string }[];
      };
      if (rows.rows.some((x) => x.r.includes(secret))) problems.push(`${name} stored in ${table_name}`);
    }
    await close2();
  }
  // The safe diagnostic event: the unknown function's failure is reported as one structured line.
  const diagnostic = server.out.stderr
    .split("\n")
    .concat(server.out.stdout.split("\n"))
    .map((l) => l.slice(l.indexOf("{")))
    .find((l) => l.startsWith('{"level":"error"') && l.includes('"ref"'));
  if (!diagnostic) problems.push("no structured error line (the safe diagnostic event) was written");

  const report = {
    server: SERVER,
    agentVariables:
      AGENT === "off"
        ? "removed"
        : Object.keys(process.env).filter((k) => AGENT_VARS.test(k)).length > 0
          ? "present"
          : "absent",
    exercised,
    markersFoundIn: found,
    secretsChecked: Object.keys(SECRETS),
    diagnosticEvent: diagnostic ? JSON.parse(diagnostic).type : null,
    capturedLines: Object.fromEntries(Object.entries(channels).map(([c, x]) => [c, x.split("\n").length])),
    output: outDir,
    problems,
  };
  console.log(JSON.stringify(report, null, 2));
  if (SELF_TEST) {
    // The planted marker must be caught; anything else found is still a failure.
    const caught = problems.some((p) => p.startsWith('"query" marker in browser console'));
    const others = problems.filter((p) => !p.startsWith('"query" marker'));
    console.log(caught && !others.length ? "Self-test: the planted marker was caught." : "Self-test FAILED.");
    process.exit(caught && !others.length ? 0 : 1);
  }
  process.exit(problems.length ? 1 : 0);
}

await main();
