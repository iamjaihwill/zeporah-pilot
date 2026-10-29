/**
 * The observability hook: one structured JSON line per unexpected server error, to the server's
 * own output. No external vendor, and no request data. Only approved diagnostic fields are written
 * (threat T19, correction L1, 2026-10-29): never an error's message or its cause's message, which
 * can quote what someone typed (a database type error quotes the value; a thrown string is
 * whatever it says).
 *
 * The fields: level, time, the reference the person can quote, the error's type, a category
 * ("database", "error" or "non-error"), and for a database error the SQLSTATE code and the schema
 * names involved (constraint, table, column), which are identifiers and never values. The stack
 * keeps call frames only ("at …" lines), never the first line, which repeats the message.
 */
import { randomBytes } from "node:crypto";

export const newReference = () => randomBytes(4).toString("hex").toUpperCase();

/** A SQLSTATE code: five digits or capitals. */
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** A Postgres identifier as the schema uses them: never a quoted value. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

type Diagnostic = {
  level: "error";
  at: string;
  ref: string;
  type: string;
  category: "database" | "error" | "non-error";
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  stack?: string;
};

/** The database's own fields from an error or its cause, kept only when they are codes or names. */
function databaseFields(e: unknown): Pick<Diagnostic, "code" | "constraint" | "table" | "column"> | null {
  for (const candidate of [e, e instanceof Error ? e.cause : undefined]) {
    if (!candidate || typeof candidate !== "object") continue;
    const c = candidate as Record<string, unknown>;
    if (typeof c["code"] !== "string" || !SQLSTATE.test(c["code"])) continue;
    const name = (k: string) =>
      typeof c[k] === "string" && IDENTIFIER.test(c[k] as string) ? { [k]: c[k] as string } : {};
    return { code: c["code"], ...name("constraint"), ...name("table"), ...name("column") };
  }
  return null;
}

/** Call frames only: "at …" lines, at most six. */
const frames = (stack: string | undefined) =>
  stack
    ?.split("\n")
    .filter((l) => /^\s+at /.test(l))
    .slice(0, 6)
    .join("\n") || undefined;

export function diagnostic(e: unknown, ref: string): Diagnostic {
  const err = e instanceof Error ? e : null;
  const db = databaseFields(e);
  const stack = frames(err?.stack);
  return {
    level: "error",
    at: new Date().toISOString(),
    ref,
    type: err ? err.name : typeof e,
    category: db ? "database" : err ? "error" : "non-error",
    ...(db ?? {}),
    ...(stack ? { stack } : {}),
  };
}

export function reportError(e: unknown, ref: string) {
  console.error(JSON.stringify(diagnostic(e, ref)));
}

/** Drop a "params: …" line (query parameters can hold what someone typed). */
export const withoutParams = (msg: string) =>
  msg.replace(/\nparams:[\s\S]*$/, "").replace(/^params:.*$/m, "");
