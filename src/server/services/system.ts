/**
 * System status for hospice operations: how this server is configured, whether the database is on
 * the latest schema, and whether the audit chain verifies. No secrets, paths or personal data.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { and, eq, gt, gte, inArray, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { mailChannel } from "../mail";
import type { DB } from "../db/client";
import { auditChainFindings } from "../audit";
import { requireStaffPermission, type ActorContext } from "../context";
import { environment } from "../environment";
import { integrationStatus } from "../integrations/registry";

const ROOT = process.cwd();

function appVersion() {
  try {
    return (
      (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version?: string }).version ??
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export async function systemStatus(db: DB, ctx: ActorContext, now = new Date()) {
  requireStaffPermission(ctx, "staff.lifecycle.manage");
  const env = environment();
  const available = readdirSync(path.join(ROOT, "src/server/db/migrations")).filter((f) =>
    f.endsWith(".sql"),
  ).length;
  let applied: number | null = null;
  try {
    const r = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    applied = (r as unknown as { rows: { n: number }[] }).rows[0]?.n ?? null;
  } catch {
    applied = null;
  }
  const chain = await auditChainFindings(db, ctx.tenantId);
  // Sign-in health over the last 24 hours, and who is signed in now (counts only).
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const signIns = await db
    .select({ action: s.auditEvents.action })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        gte(s.auditEvents.createdAt, since),
        inArray(s.auditEvents.action, ["auth.sign_in_failed", "auth.locked"]),
      ),
    );
  const [active] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.sessions)
    .where(and(eq(s.sessions.tenantId, ctx.tenantId), gt(s.sessions.expiresAt, now)));
  return {
    checkedAt: now,
    version: appVersion(),
    environment: { mode: env.mode, name: env.name, devSignIn: env.devSignIn, readOnly: env.readOnly },
    database: {
      kind: "Embedded PGlite (local files)",
      migrationsApplied: applied,
      migrationsAvailable: available,
    },
    // Findings, not a pass mark: a clean check still can't see events removed from the end (SB-04).
    audit: {
      ok: chain.findings.length === 0,
      events: chain.events,
      findings: chain.findings.length,
      kinds: [...new Set(chain.findings.map((f) => f.kind))],
    },
    integrations: integrationStatus(),
    /** Email goes only to the development mailbox (decision 18); nothing leaves this computer. */
    email: mailChannel() ? ("dev_mailbox" as const) : ("off" as const),
    signIns: {
      failed: signIns.filter((r) => r.action === "auth.sign_in_failed").length,
      paused: signIns.filter((r) => r.action === "auth.locked").length,
    },
    activeSessions: active?.n ?? 0,
    /** This prototype has no backups; production readiness covers them. */
    backups: "not_set_up" as const,
  };
}
