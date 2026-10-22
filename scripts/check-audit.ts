/**
 * Dependency vulnerability check for CI. Runs `bun audit` and fails on any advisory that isn't
 * recorded in docs/readiness/vulnerability-exceptions.json, or whose exception has expired. Recorded
 * exceptions say why the exposure is acceptable for now, who owns the fix and by when.
 *
 *   bun scripts/check-audit.ts
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type Advisory = { url: string; title: string; severity: string };
type Exception = { id: string; expires: string; owner: string };

const { exceptions } = JSON.parse(readFileSync("docs/readiness/vulnerability-exceptions.json", "utf8")) as {
  exceptions: Exception[];
};
const run = spawnSync("bun", ["audit", "--json"], { encoding: "utf8" });
const out = run.stdout.trim();
const report = (out ? JSON.parse(out) : {}) as Record<string, Advisory[]>;

const found = new Map<string, Advisory & { pkg: string }>();
for (const [pkg, list] of Object.entries(report))
  for (const a of list) {
    const id = a.url.split("/").pop()!;
    found.set(id, { ...a, pkg });
  }

const today = new Date().toISOString().slice(0, 10);
const problems: string[] = [];
for (const [id, a] of found) {
  const ex = exceptions.find((e) => e.id === id);
  if (!ex) problems.push(`${id} (${a.severity}, ${a.pkg}): not recorded. ${a.title}`);
  else if (ex.expires < today)
    problems.push(`${id}: the exception expired on ${ex.expires} (owner: ${ex.owner}).`);
}
const stale = exceptions.filter((e) => !found.has(e.id)).map((e) => e.id);

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(
  `Dependencies: ${found.size} known advisories, all recorded with an owner and expiry.` +
    (stale.length ? ` No longer reported (remove from the list): ${stale.join(", ")}.` : ""),
);
