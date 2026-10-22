/**
 * The observability hook: one structured JSON line per unexpected server error, to the server's
 * own output. No external vendor, and no request data — never a name, message text or record
 * content — only a short reference the person can quote, the error's type and message, and where.
 *
 * Database errors quote the failed query with its parameters, which can include what someone typed
 * (a message, a note). The parameters are dropped; the database's own reason is kept (e.g. a
 * missing column), because that's what explains the failure.
 */
import { randomBytes } from "node:crypto";

export const newReference = () => randomBytes(4).toString("hex").toUpperCase();

export function reportError(e: unknown, ref: string) {
  const err = e instanceof Error ? e : new Error(String(e));
  const cause = err.cause instanceof Error ? err.cause : null;
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      ref,
      type: err.name,
      message: withoutParams(err.message).slice(0, 500),
      ...(cause ? { cause: withoutParams(cause.message).slice(0, 300) } : {}),
      stack: err.stack
        ?.split("\n")
        .filter((l) => !l.startsWith("params:"))
        .slice(0, 6)
        .join("\n"),
    }),
  );
}

/** Drop a "params: …" line (query parameters can hold what someone typed). */
export const withoutParams = (msg: string) =>
  msg.replace(/\nparams:[\s\S]*$/, "").replace(/^params:.*$/m, "");
