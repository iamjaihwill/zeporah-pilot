import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { notifications, preferences } from "../db/schema";
import { emailAvailable } from "../mail";
import { staffVisibleHouseholds, type ActorContext } from "../context";

/**
 * People see notifications only about households they can see right now. Staff follow the shared
 * visibility rule (so an ended assignment hides that household's notifications); family members
 * follow their current household membership (so a membership that ends hides them too).
 * Notifications that aren't about a household are always shown. Nothing is deleted.
 */
async function visibleHouseholdIds(db: DB, ctx: ActorContext) {
  if (ctx.kind === "family") return ctx.householdRoles.map((h) => h.householdId);
  return (await staffVisibleHouseholds(db, ctx)).map((h) => h.id);
}
function aboutVisible(visible: string[] | null) {
  if (visible === null) return undefined;
  return visible.length
    ? or(isNull(notifications.householdId), inArray(notifications.householdId, visible))
    : isNull(notifications.householdId);
}

/** A person only ever sees, counts or marks their own notifications. */
export async function listNotifications(db: DB, ctx: ActorContext) {
  const visible = await visibleHouseholdIds(db, ctx);
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, ctx.tenantId),
        eq(notifications.recipientActorId, ctx.actorId),
        aboutVisible(visible),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(100);
}

export async function unreadCount(db: DB, ctx: ActorContext) {
  const visible = await visibleHouseholdIds(db, ctx);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, ctx.tenantId),
        eq(notifications.recipientActorId, ctx.actorId),
        isNull(notifications.readAt),
        aboutVisible(visible),
      ),
    );
  return r?.n ?? 0;
}

export async function markRead(db: DB, ctx: ActorContext, ids: string[] | "all") {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, ctx.tenantId),
        eq(notifications.recipientActorId, ctx.actorId),
        isNull(notifications.readAt),
        ids === "all" ? undefined : inArray(notifications.id, ids.length ? ids : ["-"]),
      ),
    );
}

/** Whether email nudges exist here (decision 23) and whether this person turned them on. */
export async function emailNoticeState(db: DB, ctx: ActorContext) {
  if (ctx.kind !== "family" || !emailAvailable()) return { available: false, on: false };
  const [p] = await db
    .select({ on: preferences.emailNotices })
    .from(preferences)
    .where(and(eq(preferences.tenantId, ctx.tenantId), eq(preferences.actorId, ctx.actorId)));
  return { available: true, on: !!p?.on };
}
