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

/**
 * Spoofed and malformed thrown values (bounded residual review, 2026-10-29). Something that throws
 * can control every property of what it throws, so each retained field is tried with private
 * text in it, and the logger itself must never throw or print the value it was given.
 *
 * The `it.fails` cases are known gaps in the L1 logger, found by this review and not yet
 * corrected (correction L6, proposed in docs/readiness/evidence/residual-logging-2026-10-29.md).
 * They pass while the gap is there; when L6 is made, each must become a normal test.
 */
const PRIVATE_TOKEN = "synthetic_private_mums_morphine_dose";
/** A line no longer than this: a type, a code, three names and six short frames fit easily. */
const LINE_LIMIT = 4096;

/** reportError must write exactly one parseable line and never throw, whatever it's given. */
function loggedSafely(error: unknown) {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  let thrown: unknown;
  try {
    reportError(error, "T19TEST2");
  } catch (e) {
    thrown = e;
  }
  const raw = spy.mock.calls.map((c) => c.map(String).join(" "));
  spy.mockRestore();
  expect(thrown, "the logger threw").toBeUndefined();
  expect(raw).toHaveLength(1);
  expect(JSON.parse(raw[0]!)).toMatchObject({ level: "error", ref: "T19TEST2" });
  return raw[0]!;
}
const withName = (name: unknown) => Object.assign(new Error("x"), { name });
const throwingGetter = (target: object, key: string) =>
  Object.defineProperty(target, key, {
    get() {
      throw new Error(PRIVATE);
    },
  });

describe("error output for spoofed error-like values", () => {
  it("an object that only looks like an error is logged as an object", () => {
    const fake = { name: PRIVATE, message: PRIVATE, stack: `Error: x\n    at ${PRIVATE}` };
    const raw = loggedSafely(fake);
    expect(raw).not.toContain(PRIVATE);
    expect(JSON.parse(raw)).toMatchObject({ type: "object", category: "non-error" });
  });

  it("a null-prototype object, a symbol and a toJSON method don't change what's written", () => {
    expect(loggedSafely(Object.assign(Object.create(null), { message: PRIVATE }))).not.toContain(PRIVATE);
    expect(loggedSafely(Symbol(PRIVATE))).not.toContain(PRIVATE);
    expect(loggedSafely(Object.assign(new Error("x"), { toJSON: () => ({ PRIVATE }) }))).not.toContain(
      PRIVATE,
    );
  });

  it("an error whose stack has no call frames has no stack field (no raw-stack fallback)", () => {
    const e = new Error("x");
    e.stack = `Error: ${PRIVATE}\n${PRIVATE}`;
    const line = JSON.parse(loggedSafely(e)) as Record<string, unknown>;
    expect(line["stack"]).toBeUndefined();
    expect(JSON.stringify(line)).not.toContain(PRIVATE);
  });

  it("a database field that isn't shaped like a code or a name is dropped", () => {
    const raw = loggedSafely({ code: "23505", table: PRIVATE, column: "Mum's dose", constraint: '"x"' });
    expect(JSON.parse(raw)).toEqual(expect.objectContaining({ category: "database", code: "23505" }));
    expect(raw).not.toContain(PRIVATE);
    expect(raw).not.toContain("Mum");
  });

  it.fails("KNOWN GAP (L6): an error name holding private text isn't logged", () => {
    expect(loggedSafely(withName(PRIVATE))).not.toContain(PRIVATE);
  });

  it.fails("KNOWN GAP (L6): an error name that isn't a string isn't serialized", () => {
    expect(loggedSafely(withName({ secret: PRIVATE }))).not.toContain(PRIVATE);
  });

  it.fails("KNOWN GAP (L6): message lines shaped like call frames aren't kept as frames", () => {
    expect(loggedSafely(new Error(`first\n    at ${PRIVATE} (file.ts:1:1)`))).not.toContain(PRIVATE);
  });

  it.fails("KNOWN GAP (L6): a table name is kept only if the schema has that table", () => {
    expect(loggedSafely({ code: "23505", table: PRIVATE_TOKEN })).not.toContain(PRIVATE_TOKEN);
  });

  it("RESIDUAL (accepted until reviewed): an identifier-shaped column or constraint name is kept", () => {
    // An undefined-column error (42703) names a column the schema doesn't have, so columns and
    // constraints can't be checked against the schema; only their shape is. Postgres sets these
    // fields itself, from object names, never from values.
    const raw = loggedSafely({ code: "42703", column: PRIVATE_TOKEN, constraint: PRIVATE_TOKEN });
    expect(JSON.parse(raw)).toMatchObject({ column: PRIVATE_TOKEN, constraint: PRIVATE_TOKEN });
  });

  it.fails("KNOWN GAP (L6): an operating-system code (EPERM) isn't taken for a database code", () => {
    expect(JSON.parse(loggedSafely(Object.assign(new Error("x"), { code: "EPERM" })))).toMatchObject({
      category: "error",
    });
  });

  it.fails("KNOWN GAP (L6): every field has a length limit", () => {
    expect(loggedSafely(withName("E".repeat(100_000))).length).toBeLessThanOrEqual(LINE_LIMIT);
  });

  it.fails("KNOWN GAP (L6): a frame has a length limit", () => {
    const e = new Error("x");
    e.stack = `Error: x\n    at ${"f".repeat(100_000)} (/a.ts:1:1)`;
    expect(loggedSafely(e).length).toBeLessThanOrEqual(LINE_LIMIT);
  });
});

describe("the logger never throws on a malformed value", () => {
  // When reportError throws inside run()'s catch (src/server/rpc.ts), nothing is logged and the
  // thrown error (here, one whose message is the private text) goes back in the reply instead.
  const cases: Record<string, () => unknown> = {
    "an error name that is a BigInt": () => withName(10n),
    "a name getter that throws": () => throwingGetter(new Error("x"), "name"),
    "a stack that isn't a string": () => Object.assign(new Error("x"), { stack: { secret: PRIVATE } }),
    "a stack getter that throws": () => throwingGetter(new Error("x"), "stack"),
    "a cause getter that throws": () => throwingGetter(new Error("x"), "cause"),
    "a code getter that throws": () => throwingGetter({}, "code"),
    "a proxy that throws on every read": () =>
      new Proxy(
        {},
        {
          get() {
            throw new Error(PRIVATE);
          },
          getPrototypeOf() {
            throw new Error(PRIVATE);
          },
        },
      ),
  };
  for (const [name, make] of Object.entries(cases))
    it.fails(`KNOWN GAP (L6): ${name}`, () => {
      expect(loggedSafely(make())).not.toContain(PRIVATE);
    });
});
