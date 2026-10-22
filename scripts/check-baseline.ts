/**
 * Frozen demo-baseline check for CI: every file in docs/demo-baseline-2026-10-22.sha256 must still
 * match. A change to a frozen file needs the founder to lift the freeze for it; that change then
 * refreshes the manifest in the same reviewed change (docs/release-governance.md). Same result as
 * `shasum -a 256 -c`, on any platform.
 *
 *   bun scripts/check-baseline.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const manifest = "docs/demo-baseline-2026-10-22.sha256";
const lines = readFileSync(manifest, "utf8").split("\n").filter(Boolean);
const changed: string[] = [];
for (const line of lines) {
  const [hash, file] = [line.slice(0, 64), line.slice(66)];
  if (!existsSync(file)) changed.push(`${file} (missing)`);
  else if (createHash("sha256").update(readFileSync(file)).digest("hex") !== hash) changed.push(file);
}
if (changed.length) {
  console.error(
    `✗ ${changed.length} frozen file(s) differ from ${manifest}:\n` +
      changed.map((f) => `  ${f}`).join("\n") +
      "\nA frozen file changes only after the founder lifts the freeze, with the manifest refreshed in the same change.",
  );
  process.exit(1);
}
console.log(`Frozen baseline: all ${lines.length} files match.`);
