/**
 * Sessions. The browser holds a random token in an HTTP-only cookie; the database keeps only its
 * SHA-256, so a copy of the database can't be used to sign in. Every sign-in replaces the previous
 * session in that browser. Password sessions are tied to an account and stop working if that
 * account no longer matches; development persona sessions exist only behind the development gate
 * (see ./auth/dev-gate.ts). Real identity hardening (MFA, recovery, device management) remains a
 * production gate (docs/production-readiness-gates.md).
 */
import { and, eq, gt } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { getDb, type Conn, type DB } from "./db/client";
import { actors, sessions, users } from "./db/schema";
import { AccessError, loadContext, type ActorContext } from "./context";
import { appendAudit } from "./audit";
import { hashToken, newToken } from "./auth/crypto";
import { devSignInEnabled } from "./auth/dev-gate";

const COOKIE = "zp_session";
const HOURS = 12;
/** "Remember me" on the family sign-in (founder decision 53): 30 days on that device. */
export const REMEMBER_DAYS = 30;

type SessionMethod = "password" | "development_persona";

/** Creates a session row and returns the token for the cookie. Usable without a request (tests). */
export async function createSession(
  conn: Conn,
  s: { tenantId: string; actorId: string; userId: string | null; method: SessionMethod; remember?: boolean },
) {
  const token = newToken();
  const lasts = s.remember ? REMEMBER_DAYS * 24 * 3_600_000 : HOURS * 3_600_000;
  await conn.insert(sessions).values({
    id: hashToken(token),
    tenantId: s.tenantId,
    actorId: s.actorId,
    userId: s.userId,
    method: s.method,
    expiresAt: new Date(Date.now() + lasts),
  });
  await appendAudit(conn, {
    tenantId: s.tenantId,
    actorId: s.actorId,
    action: "session.started",
    subjectType: "session",
    subjectId: null,
    summary:
      s.method === "password"
        ? "Signed in with an email and password."
        : "A development persona session started.",
    visibility: "staff",
    context: { method: s.method, remember: !!s.remember },
  });
  return token;
}

/** The actor for a session token, or null. Checks expiry and, for password sessions, the account. */
export async function actorForToken(db: DB, token: string): Promise<ActorContext | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  if (row.method === "development_persona" && !devSignInEnabled()) return null;
  if (row.method === "password") {
    const [u] = row.userId ? await db.select().from(users).where(eq(users.id, row.userId)) : [];
    if (!u || u.actorId !== row.actorId || u.tenantId !== row.tenantId) return null;
  }
  try {
    return await loadContext(db, row.actorId, row.tenantId);
  } catch {
    return null;
  }
}

export async function currentActor(): Promise<{ db: DB; ctx: ActorContext } | null> {
  const token = getCookie(COOKIE);
  if (!token) return null;
  const db = await getDb();
  const ctx = await actorForToken(db, token);
  return ctx ? { db, ctx } : null;
}

export async function requireActor() {
  const a = await currentActor();
  if (!a) throw new AccessError("NOT_AUTHENTICATED", "Please sign in to continue.");
  return a;
}

/** Ends any session in this browser, then starts a new one and sets the cookie. */
export async function startSession(s: {
  tenantId: string;
  actorId: string;
  userId: string | null;
  method: SessionMethod;
  remember?: boolean;
}) {
  await endSession();
  const db = await getDb();
  const token = await createSession(db, s);
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    maxAge: s.remember ? REMEMBER_DAYS * 24 * 3600 : HOURS * 3600,
  });
}

/** DEVELOPMENT ONLY: sign in as a synthetic persona. Refused unless the development gate is on. */
export async function startDevPersonaSession(actorId: string, tenantId: string) {
  if (!devSignInEnabled()) throw new AccessError("NOT_PERMITTED", "Persona sign-in isn't available here.");
  const db = await getDb();
  const [actor] = await db
    .select()
    .from(actors)
    .where(and(eq(actors.id, actorId), eq(actors.tenantId, tenantId)));
  if (!actor) throw new AccessError("INVALID", "That persona isn't available.");
  await startSession({ tenantId, actorId, userId: null, method: "development_persona" });
  return actor;
}

export async function endSession() {
  const token = getCookie(COOKIE);
  if (token) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, hashToken(token)));
    if (row) {
      await db.delete(sessions).where(eq(sessions.id, row.id));
      await appendAudit(db, {
        tenantId: row.tenantId,
        actorId: row.actorId,
        action: "session.ended",
        subjectType: "session",
        subjectId: null,
        summary: "Signed out.",
        visibility: "staff",
      });
    }
  }
  deleteCookie(COOKIE, { path: "/" });
}
