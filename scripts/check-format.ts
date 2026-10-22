/**
 * Formatting check for CI. Every file Prettier covers must be formatted, except the files listed in
 * docs/readiness/format-exceptions.txt: frozen demo-baseline files that were unformatted at the
 * freeze and can't be changed until the founder lifts the freeze for them. The check also fails if
 * a listed file has since been formatted (so the list only ever shrinks) or no longer exists.
 *
 *   bun scripts/check-format.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const allowed = new Set(
  readFileSync("docs/readiness/format-exceptions.txt", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#")),
);
const run = spawnSync("bunx", ["prettier", "--list-different", "."], { encoding: "utf8" });
if (run.status !== 0 && run.status !== 1) {
  console.error(run.stderr || "Prettier didn't run.");
  process.exit(2);
}
const different = new Set(
  run.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean),
);

const problems: string[] = [];
for (const f of different)
  if (!allowed.has(f)) problems.push(`${f} isn't formatted (run: bunx prettier --write ${f}).`);
for (const f of allowed) {
  if (!existsSync(f))
    problems.push(`${f} is listed as an exception but no longer exists; remove it from the list.`);
  else if (!different.has(f))
    problems.push(`${f} is formatted now; remove it from docs/readiness/format-exceptions.txt.`);
}
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Formatting: clean apart from ${allowed.size} frozen-baseline exceptions.`);
