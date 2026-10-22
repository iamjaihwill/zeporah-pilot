/**
 * Checks that every relative link in the documentation points at a file or folder that exists, so
 * readiness documents can't quietly point at nothing (production readiness PB-17). External links
 * and in-page anchors aren't checked. Exit code 1 lists every broken link.
 *
 *   bun scripts/check-doc-links.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const roots = ["README.md", "docs"];
const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (p.endsWith(".md")) files.push(p);
};
for (const r of roots) if (existsSync(r)) walk(r);

const broken: string[] = [];
for (const f of files) {
  const text = readFileSync(f, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1]!;
    if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
    const path = decodeURIComponent(target.split("#")[0]!);
    if (!path) continue;
    if (!existsSync(resolve(dirname(f), path))) broken.push(`${f}: ${target}`);
  }
}
if (broken.length) {
  console.error(broken.map((b) => `✗ ${b}`).join("\n"));
  process.exit(1);
}
console.log(`Documentation links: ${files.length} files, no broken relative links.`);
