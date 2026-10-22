/**
 * Small pieces shared by Audit review and the household record's timeline: where an event's record
 * lives, and the badges that say where an event came from (decision 58).
 */
import { AUDIT_SOURCE_LABELS, PREPARED_LABEL, type AuditSource } from "@/domain/audit-shape";

/** Where an event's record lives, when there's a page for it the viewer can open. */
export function recordLink(e: {
  householdId: string | null;
  subjectType: string;
  subjectId: string | null;
}): { to: string; params?: Record<string, string>; search?: Record<string, string>; hash?: string } | null {
  const id = e.subjectId;
  const h = e.householdId;
  const tab = (t: string, hash?: string) =>
    h
      ? {
          to: "/staff/households/$householdId",
          params: { householdId: h },
          search: { tab: t },
          ...(hash ? { hash } : {}),
        }
      : null;
  if (e.subjectType === "consent" && id)
    return { to: "/staff/sharing/$consentId", params: { consentId: id } };
  if (e.subjectType === "packet" && id) return { to: "/staff/packets/$packetId", params: { packetId: id } };
  if (e.subjectType === "escalation" && id)
    return { to: "/staff/exceptions", search: { view: "all", sel: `escalation:${id}` } };
  if (e.subjectType === "task" && id) return tab("tasks", `task-${id}`);
  if (e.subjectType === "bereavement_contact" && id) return tab("overview", `checkin-${id}`);
  if (e.subjectType === "authority_evidence") return tab("sharing");
  if (e.subjectType === "vault_item") return tab("vault");
  if (e.subjectType === "message") return tab("messages");
  if (e.subjectType === "family_update" || e.subjectType === "update") return tab("updates");
  if (e.subjectType === "actor" && id && !h) return { to: "/staff/team/$actorId", params: { actorId: id } };
  return tab("overview");
}

/** Where an event didn't come from a staff member's own action, or used prepared content, say so. */
export function ShapeBadges({ e }: { e: { source: AuditSource | null; prepared: boolean } }) {
  const shown = e.source && e.source !== "staff" ? AUDIT_SOURCE_LABELS[e.source] : null;
  if (!shown && !e.prepared) return null;
  return (
    <>
      {shown && (
        <span className="rounded-full border px-1.5 text-[0.6875rem] font-semibold text-ink-soft">
          {shown}
        </span>
      )}
      {e.prepared && (
        <span className="rounded-full border border-harbor/30 bg-harbor-soft px-1.5 text-[0.6875rem] font-semibold text-harbor">
          {PREPARED_LABEL}
        </span>
      )}
    </>
  );
}
