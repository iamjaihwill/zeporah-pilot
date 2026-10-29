import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as s from "@/server/db/schema";
import { reportError } from "@/server/observability";

/**
 * Threat T19 (docs/architecture/threat-model.md): what someone typed never reaches the server's
 * error output. tests/unit/errors.test.ts checks a hand-made error; this file makes the database
 * itself fail on queries carrying private text, the way a real bug would, and then tries every
 * shape a thrown value can take.
 *
 * Each case first confirms the private text really is in the thrown value, so a pass can't come
 * from there being nothing to remove. What must survive is the safe diagnostic event (level,
 * reference, error type), not the database's own wording, which isn't an approved category.
 *
 * Four cases were known gaps when found on 2026-10-29 (the logger wrote an error's message and its
 * cause's message as they were) and ran as expected failures. Correction L1, made the same day
 * under a lift, writes approved fields only, so they are normal tests now: see
 * docs/readiness/evidence/logging-paths-2026-10-29.md.
 */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const PRIVATE = "Synthetic private words: Mum's morphine dose was missed tonight";

/** Whether the thrown value holds the private text anywhere a logger could reach. */
function carries(e: unknown, seen = new Set<unknown>()): boolean {
  if (typeof e === "string") return e.includes(PRIVATE);
  if (!e || typeof e !== "object" || seen.has(e)) return false;
  seen.add(e);
  const values = [
    ...Object.values(e as object),
    ...(e instanceof Error ? [e.message, e.stack, e.cause] : []),
    ...(e instanceof AggregateError ? e.errors : []),
  ];
  return values.some((v) => carries(v, seen));
}

/** The one line reportError writes for `error`, and the raw output, after checking the precondition. */
function logged(error: unknown) {
  expect(carries(error), "the thrown value should hold the private text").toBe(true);
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  reportError(error, "T19TEST1");
  const raw = spy.mock.calls.map((c) => c.map(String).join(" "));
  spy.mockRestore();
  expect(raw).toHaveLength(1);
  const line = JSON.parse(raw[0]!) as Record<string, unknown>;
  // The safe diagnostic event.
  expect(line).toMatchObject({ level: "error", ref: "T19TEST1" });
  expect(typeof line["type"]).toBe("string");
  return raw[0]!;
}

async function thrownBy(fail: () => Promise<unknown> | unknown) {
  try {
    await fail();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to fail");
}

describe("error output after a real database failure", () => {
  it("drops the query's parameters from a failed insert", async () => {
    const e = await thrownBy(() =>
      t.db.insert(s.messages).values({
        tenantId: "tn-none",
        householdId: "hh-none",
        threadId: "th-none",
        authorActorId: "ac-none",
        body: PRIVATE,
      } as never),
    );
    expect(logged(e)).not.toContain(PRIVATE);
  });

  it("drops parameters from a failed update", async () => {
    const e = await thrownBy(() =>
      t.db
        .update(s.messages)
        .set({ body: PRIVATE, tenantId: null } as never)
        .where(undefined as never),
    );
    expect(logged(e)).not.toContain(PRIVATE);
  });

  it("doesn't log the database's detail fields (which can quote row values)", async () => {
    const e = (await thrownBy(() => t.db.execute(sql`select 1 / 0 where ${PRIVATE} <> ''`))) as Error & {
      cause?: Record<string, unknown>;
    };
    const raw = logged(e);
    expect(raw).not.toContain(PRIVATE);
    for (const field of ["detail", "hint", "where", "internalQuery", "params"])
      expect(raw, field).not.toContain(`"${field}"`);
  });

  it("a type error's cause, which quotes the typed value, isn't logged", async () => {
    // PGlite: 'invalid input syntax for type integer: "<the value>"', in the cause's message.
    const e = await thrownBy(() => t.db.execute(sql`select ${PRIVATE}::int`));
    const raw = logged(e);
    expect(raw).not.toContain(PRIVATE);
    // What's kept is the approved category and the database's code (22P02: invalid text representation).
    expect(JSON.parse(raw)).toMatchObject({ category: "database", code: "22P02" });
  });
});

describe("error output for every shape a thrown value can take", () => {
  it("a plain object is logged by type only", () => {
    expect(logged({ secret: PRIVATE })).not.toContain(PRIVATE);
  });

  it("a circular structure is logged without walking it", () => {
    const circ: Record<string, unknown> = { secret: PRIVATE };
    circ["self"] = circ;
    expect(logged(circ)).not.toContain(PRIVATE);
  });

  it("an AggregateError's inner errors aren't logged", () => {
    expect(logged(new AggregateError([new Error(PRIVATE)], "several failed"))).not.toContain(PRIVATE);
  });

  it("a cause two levels down isn't logged", () => {
    const e = new Error("outer", { cause: new Error("middle", { cause: new Error(PRIVATE) }) });
    expect(logged(e)).not.toContain(PRIVATE);
  });

  it("parameters in a stack line are dropped", () => {
    const e = new Error("Failed query: insert …");
    e.stack = `Error: Failed query: insert …\nparams: ${PRIVATE}\n    at somewhere (file.ts:1:1)`;
    expect(logged(e)).not.toContain(PRIVATE);
  });

  it("a thrown string isn't logged", () => {
    expect(logged(PRIVATE)).not.toContain(PRIVATE);
  });

  it("an error message that quotes a value isn't logged", () => {
    expect(logged(new Error(`Could not save "${PRIVATE}"`))).not.toContain(PRIVATE);
  });

  it("a cause's message isn't logged", () => {
    expect(logged(new Error("outer", { cause: new Error(`inner: ${PRIVATE}`) }))).not.toContain(PRIVATE);
  });
});
