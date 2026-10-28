import { and, eq } from "drizzle-orm";
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
