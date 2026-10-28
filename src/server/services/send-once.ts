import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/client";
import * as s from "../db/schema";
import { AccessError, type ActorContext } from "../context";

/** Postgres's unique-violation code, wherever drizzle wraps it. */
const isUniqueViolation = (e: unknown) => {
  for (let c = e as { code?: string; cause?: unknown } | undefined; c; c = c.cause as typeof c)
    if (c.code === "23505") return true;
  return false;
};

export const SENT_DIFFERENTLY = "That was already sent with different words. Nothing more was sent.";

/**
 * Creates something at most once per submission ID (brief reconciliation increment 3). A person's
 * device keeps one ID for a send until the server confirms it, so a retry after a lost reply finds
 * the first copy instead of making a second. A different body under the same ID is refused.
 * Without an ID it just creates. The unique index catches two copies racing each other.
 */
export async function createOnce<T>(
  submissionId: string | undefined,
  find: () => Promise<T | undefined>,
  same: (prior: T) => boolean,
  create: () => Promise<T>,
): Promise<{ row: T; replayed: boolean }> {
  const replay = async () => {
    const prior = await find();
    if (!prior) return null;
    if (!same(prior)) throw new AccessError("CONFLICT", SENT_DIFFERENTLY);
    return { row: prior, replayed: true };
  };
  if (submissionId) {
    const r = await replay();
    if (r) return r;
  }
  try {
    return { row: await create(), replayed: false };
  } catch (e) {
    if (submissionId && isUniqueViolation(e)) {
      const r = await replay();
      if (r) return r;
    }
    throw e;
  }
}

/** The message an author already sent under this submission ID, if any. */
export async function messageBySubmission(conn: Conn, ctx: ActorContext, submissionId: string) {
  const [m] = await conn
    .select()
    .from(s.messages)
    .where(
      and(
        eq(s.messages.tenantId, ctx.tenantId),
        eq(s.messages.authorActorId, ctx.actorId),
        eq(s.messages.submissionId, submissionId),
      ),
    );
  return m;
}

/** At most this many uncertain sends are checked at once (one device rarely has more than one). */
export const MAX_CHECKED = 20;

/**
 * Decision 86: settle sends the device couldn't confirm. For each submission ID, whether this
 * person's message or support request with that ID arrived, and when. Only the person's own sends
 * are found, and nothing about their content is returned; an ID that isn't theirs reads as "didn't
 * arrive". Nothing is sent or resent here.
 */
export async function submissionStatus(conn: Conn, ctx: ActorContext, ids: string[]) {
  const want = [...new Set(ids)].slice(0, MAX_CHECKED);
  if (!want.length) return [];
  const messages = await conn
    .select({ id: s.messages.submissionId, at: s.messages.createdAt })
    .from(s.messages)
    .where(
      and(
        eq(s.messages.tenantId, ctx.tenantId),
        eq(s.messages.authorActorId, ctx.actorId),
        inArray(s.messages.submissionId, want),
      ),
    );
  const requests = await conn
    .select({ id: s.escalations.submissionId, at: s.escalations.createdAt })
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.raisedByActorId, ctx.actorId),
        inArray(s.escalations.submissionId, want),
      ),
    );
  const found = new Map([...messages, ...requests].map((r) => [r.id!, r.at]));
  return want.map((id) => ({ id, arrived: found.has(id), at: found.get(id) ?? null }));
}
