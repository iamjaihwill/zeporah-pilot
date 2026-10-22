/**
 * Role homes (decision 58, workstream 4). Each widget is one number and the three oldest items
 * behind it, and the number links to the filtered list. Read-only: every action happens in the
 * exception, the record or the workflow it opens. Built from the same exception rows the person
 * already sees, so a home can never show more than its list.
 */
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import type { ActorContext } from "../context";
import { guideRole, type GuideRole } from "@/domain/staff-guide";
import { CATEGORY_LABELS, type QueueRow } from "@/domain/queue";

const DAY = 86_400_000;

export type WidgetItem = {
  id: string;
  label: string;
  household: string;
  since: Date;
  age: string;
  /** Access that's ending says when it ends, not how long it has been listed (demo rehearsal, S-3). */
  endsAt: Date | null;
  link: string;
};
export type Widget = {
  key: string;
  title: string;
  count: number;
  /** What the number counts, for screen readers and the tooltip ("3 need you"). */
  countLabel: string;
  link: { to: string; search?: Record<string, string> };
  items: WidgetItem[];
  /** One plain sentence when the count is zero. */
  empty: string;
  /** An extra line under the number (e.g. "2 care guides away now or soon"). */
  note?: string;
};

const item = (r: QueueRow): WidgetItem => ({
  id: r.id,
  label: `${CATEGORY_LABELS[r.category]}: ${r.summary}`,
  household: r.household,
  since: r.since,
  age: r.age,
  endsAt: r.category === "access_ending" ? r.dueBy : null,
  link: `/staff/exceptions?view=all&sel=${encodeURIComponent(r.id)}`,
});
/** The three oldest first: what has waited longest. */
const oldest = (rows: QueueRow[]) =>
  [...rows]
    .sort((a, b) => a.since.getTime() - b.since.getTime())
    .slice(0, 3)
    .map(item);

function widget(
  key: string,
  title: string,
  rows: QueueRow[],
  countWord: string,
  search: Record<string, string>,
  empty: string,
): Widget {
  return {
    key,
    title,
    count: rows.length,
    countLabel: `${rows.length} ${countWord}`,
    link: { to: "/staff/exceptions", search },
    items: oldest(rows),
    empty,
  };
}

export async function commandCenter(
  db: DB,
  ctx: ActorContext,
  rows: QueueRow[],
  recent: { id: string; name: string; who: string; last: string; at: Date }[],
  now = new Date(),
): Promise<{ role: GuideRole; widgets: Widget[] }> {
  const role = guideRole(ctx.staffRoles);
  const mine = rows.filter((r) => r.mine);
  const unowned = rows.filter((r) => r.ownerIds.length === 0);
  const due = rows.filter((r) => r.due !== null);
  const family = rows.filter(
    (r) => r.waitingOn === "family" || r.category === "family_contact" || r.category === "unread_update",
  );
  const partner = rows.filter((r) => r.waitingOn === "partner" || r.category === "partner_waiting");
  const ending = rows.filter((r) => r.category === "access_ending");
  const releases = rows.filter((r) => r.category === "release_incomplete");
  const reviews = rows.filter((r) => r.category === "consent_held" || r.category === "missing_consent");

  const W = {
    mine: widget("mine", "Needs you now", mine, "need you", { view: "mine" }, "Nothing needs you right now."),
    unowned: widget(
      "unowned",
      "No owner",
      unowned,
      "have no owner",
      { view: "unowned" },
      "Everything has an owner.",
    ),
    due: widget(
      "due",
      "Due or overdue",
      due,
      "due today or overdue",
      { view: "due" },
      "Nothing is due today or overdue.",
    ),
    family: widget(
      "family",
      "Waiting on family",
      family,
      "waiting on a family",
      { view: "family" },
      "Nothing is waiting on a family.",
    ),
    partner: widget(
      "partner",
      "Waiting on partners",
      partner,
      "waiting on an outside organization",
      { view: "partner" },
      "Nothing is waiting on an outside organization.",
    ),
    ending: widget(
      "ending",
      "Access ending",
      ending,
      "ending soon",
      { view: "consent", category: "access_ending" },
      "No consent or outside access ends soon.",
    ),
    releases: widget(
      "releases",
      "Releases in progress",
      releases,
      "not released yet",
      { view: "releases" },
      "No releases in progress.",
    ),
    reviews: widget(
      "reviews",
      "Review backlog",
      reviews,
      "waiting for review",
      { view: "consent" },
      "Nothing is waiting for review.",
    ),
  };
  if (reviews.length) W.reviews.note = `Oldest waiting ${oldestAge(reviews)}`;

  if (role === "care_guide") {
    const changed = recent.filter((r) => r.at.getTime() > now.getTime() - DAY);
    return {
      role,
      widgets: [
        W.mine,
        W.due,
        W.family,
        W.partner,
        W.ending,
        {
          key: "changed",
          title: "Changed in the last day",
          count: changed.length,
          countLabel: `${changed.length} household${changed.length === 1 ? "" : "s"} changed in the last day`,
          link: { to: "/staff/households" },
          // The newest, here: this one is about what just happened.
          items: changed.slice(0, 3).map((r) => ({
            id: r.id,
            label: `${r.who} ${r.last}`,
            household: r.name,
            since: r.at,
            age: "",
            endsAt: null,
            link: `/staff/households/${r.id}?tab=overview`,
          })),
          empty: "Nothing changed in your households in the last day.",
        },
      ],
    };
  }

  if (role === "hospice_ops") {
    const coverageRows = rows.filter(
      (r) => r.category === "coverage_gap" || r.category === "stalled_handoff",
    );
    const away = await db
      .select({ id: s.staffAbsences.id })
      .from(s.staffAbsences)
      .where(
        and(
          eq(s.staffAbsences.tenantId, ctx.tenantId),
          isNull(s.staffAbsences.cancelledAt),
          gt(s.staffAbsences.endsAt, now),
          lte(s.staffAbsences.startsAt, new Date(now.getTime() + 3 * DAY)),
        ),
      );
    const coverage = widget(
      "coverage",
      "Coverage",
      coverageRows,
      "coverage gaps or stalled handoffs",
      { view: "handoffs" },
      "Every household has an available care guide.",
    );
    if (away.length)
      coverage.note = `${away.length} care guide${away.length === 1 ? "" : "s"} away now or soon`;
    return { role, widgets: [W.unowned, W.mine, coverage, W.releases, W.partner, W.ending] };
  }

  // Reviewers (and anyone else who works on households).
  return {
    role,
    widgets: [W.reviews, W.mine, { ...W.ending, title: "Consent & access ending" }, W.releases],
  };
}

function oldestAge(rows: QueueRow[]) {
  return [...rows].sort((a, b) => a.since.getTime() - b.since.getTime())[0]!.age;
}
