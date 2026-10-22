/**
 * Checks the production-readiness tracker (docs/readiness/tracker.json) for internal consistency.
 * It enforces the program's rule that writing a document never closes a gap: a closed item needs
 * evidence of a kind other than a document, and a signed approval from each of its approvers. It
 * reads only the tracker and changes nothing. Exit code 1 lists every problem.
 *
 *   bun scripts/readiness-check.ts
 */
import { readFileSync } from "node:fs";

type Evidence = { type: string; ref: string; date: string };
type Approval = { role: string; date: string; ref: string };
type Item = {
  id: string;
  class: "pilot_blocker" | "pilot_condition" | "scale_blocker";
  status: string;
  owner: string;
  approvers: string[];
  dependsOn: string[];
  decisions: string[];
  closureCriteria: string;
  compensatingControl?: string | null;
  evidence: Evidence[];
  approvals: Approval[];
};

const STATUSES = ["open", "in_progress", "evidence_submitted", "closed", "accepted_with_control"];
/** Evidence that shows something works, as opposed to a document saying it should. */
const PROOF = ["test", "drill", "configuration_review", "signed_agreement", "scan", "session_findings"];

const { items } = JSON.parse(readFileSync("docs/readiness/tracker.json", "utf8")) as { items: Item[] };
const problems: string[] = [];
const ids = new Set(items.map((i) => i.id));

if (ids.size !== items.length) problems.push("Duplicate item IDs.");
for (let n = 1; n <= 17; n++) {
  const id = `PB-${String(n).padStart(2, "0")}`;
  if (!ids.has(id)) problems.push(`${id} is missing: every known pilot blocker must be tracked.`);
}
for (const i of items) {
  const at = `${i.id}:`;
  if (!STATUSES.includes(i.status)) problems.push(`${at} unknown status "${i.status}".`);
  if (!i.closureCriteria?.trim()) problems.push(`${at} no closure criterion.`);
  if (!i.approvers?.length) problems.push(`${at} no approver.`);
  for (const d of i.dependsOn) if (!ids.has(d)) problems.push(`${at} depends on unknown ${d}.`);
  for (const e of i.evidence)
    if (!e.type || !e.ref || !e.date) problems.push(`${at} evidence needs a type, a reference and a date.`);

  if (i.status === "closed") {
    if (!i.evidence.some((e) => PROOF.includes(e.type)))
      problems.push(`${at} closed without proof: needs one of ${PROOF.join(", ")}, not only documents.`);
    for (const role of i.approvers)
      if (!i.approvals.some((a) => a.role === role && a.date && a.ref))
        problems.push(`${at} closed without ${role}'s signed approval.`);
    for (const d of i.dependsOn) {
      const dep = items.find((x) => x.id === d);
      if (dep && dep.status !== "closed" && dep.status !== "accepted_with_control")
        problems.push(`${at} closed while ${d} is still ${dep.status}.`);
    }
  }
  if (i.status === "accepted_with_control") {
    if (i.class !== "pilot_condition")
      problems.push(`${at} only pilot conditions can be accepted with a compensating control.`);
    if (!i.compensatingControl?.trim())
      problems.push(`${at} accepted without a written compensating control.`);
    if (!i.approvals.some((a) => a.date && a.ref)) problems.push(`${at} accepted without a signed approval.`);
  }
}

const open = items.filter((i) => i.class === "pilot_blocker" && i.status !== "closed").length;
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Tracker consistent: ${items.length} items, ${open} of 17 pilot blockers open.`);
console.log(
  open ? "Stage 1 gate: NOT passed." : "Stage 1 gate: every pilot blocker closed; signatures still required.",
);
