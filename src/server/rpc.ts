import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import type { DB } from "./db/client";
import { AccessError, type ActorContext } from "./context";
import { requireActor } from "./session";
import { READ_ONLY_MESSAGE, environment } from "./environment";
import { newReference, reportError } from "./observability";

/** Every server function returns this. Refusals carry a stable code and a message safe to show. */
export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: AccessError["code"] | "ERROR" | "READ_ONLY";
      message: string;
      /** Unexpected errors only: the one reference shown to the person and written to the server log. */
      reference?: string;
    };

/** HTTP status for each refusal, so a failed server-function call never answers 200. */
export const STATUS: Record<string, number> = {
  NOT_AUTHENTICATED: 401,
  NOT_PERMITTED: 403,
  OUT_OF_SCOPE: 404,
  INVALID: 400,
  CONFLICT: 409,
  READ_ONLY: 503,
  ERROR: 500,
};

/**
 * Set the status on a server-function call's own response. During server rendering a loader calls
 * server functions in-process, and the page itself should still render (it shows the refusal), so
 * the page's status is left alone.
 */
function failStatus(code: string) {
  try {
    const url = new URL(getRequest().url);
    if (url.pathname.startsWith("/_serverFn")) setResponseStatus(STATUS[code] ?? 500);
  } catch {
    // Outside a request (tests): nothing to set.
  }
}

/** The HTTP method of the current server-function call, or null outside a request (tests). */
function requestMethod() {
  try {
    return getRequest().method;
  } catch {
    return null;
  }
}

/** Read-only mode refuses changes: server functions that change things are POST; reads are GET. */
export function refusedAsReadOnly(readOnly: boolean, method: string | null) {
  return readOnly && method !== null && method.toUpperCase() !== "GET";
}

export async function run<T>(fn: (db: DB, ctx: ActorContext) => Promise<T>): Promise<Result<T>> {
  try {
    const { db, ctx } = await requireActor();
    // Incident control: in read-only mode every change is refused before it starts.
    if (refusedAsReadOnly(environment().readOnly, requestMethod())) {
      failStatus("READ_ONLY");
      return { ok: false, code: "READ_ONLY", message: READ_ONLY_MESSAGE };
    }
    return { ok: true, data: await fn(db, ctx) };
  } catch (e) {
    if (e instanceof AccessError) {
      failStatus(e.code);
      return { ok: false, code: e.code, message: e.message };
    }
    const reference = newReference();
    reportError(e, reference);
    failStatus("ERROR");
    return { ok: false, code: "ERROR", message: unexpectedMessage(reference), reference };
  }
}

/** The one wording for an unexpected error (item 3 of the 2026-10-13 interaction review). */
export const unexpectedMessage = (reference: string) =>
  `Something went wrong on our side. Nothing was changed. If it keeps happening, share this reference: ${reference}.`;
