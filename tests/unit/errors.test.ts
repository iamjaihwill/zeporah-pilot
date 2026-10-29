import { describe, expect, it, vi } from "vitest";
import { reportError, withoutParams } from "@/server/observability";
import { STATUS, unexpectedMessage } from "@/server/rpc";

/** Interaction review 2026-10-13, item 3: one error state, one reference, real HTTP statuses. */
describe("unexpected errors", () => {
  it("use one message with the reference once", () => {
    const m = unexpectedMessage("CD22D827");
    expect(m).toBe(
      "Something went wrong on our side. Nothing was changed. If it keeps happening, share this reference: CD22D827.",
    );
    expect(m.match(/Nothing was changed/g)).toHaveLength(1);
  });

  it("are logged with the same reference and approved fields only, never the query's parameters", () => {
    // Threat T19, correction L1: the database's own wording isn't kept; its code and names are.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error('column "email_notices" does not exist'), {
      code: "42703",
      table: "preferences",
      column: "email_notices",
    });
    const e = new Error(
      'Failed query: insert into "messages" ("body") values ($1)\nparams: my private words',
      {
        cause,
      },
    );
    reportError(e, "AB12CD34");
    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    spy.mockRestore();
    expect(line).toMatchObject({
      ref: "AB12CD34",
      category: "database",
      code: "42703",
      table: "preferences",
      column: "email_notices",
    });
    expect(line).not.toHaveProperty("message");
    expect(line).not.toHaveProperty("cause");
    expect(JSON.stringify(line)).not.toContain("my private words");
    expect(withoutParams("a\nparams: x, y")).toBe("a");
  });

  it("answer with a real HTTP status, never 200", () => {
    expect(STATUS).toMatchObject({
      NOT_AUTHENTICATED: 401,
      NOT_PERMITTED: 403,
      OUT_OF_SCOPE: 404,
      INVALID: 400,
      CONFLICT: 409,
      READ_ONLY: 503,
      ERROR: 500,
    });
  });
});
