import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers";
import * as s from "@/server/db/schema";
import { reportError } from "@/server/observability";

/**
 * Threat T19 (docs/architecture/threat-model.md): what someone typed never reaches the server's
 * error output. tests/unit/errors.test.ts checks a hand-made error; this one makes the database
 * itself fail on a query carrying private text, the way a real bug would, and checks the one line
 * reportError writes: no message, cause or stack line contains the text, and the database's reason
 * is still there to explain the failure.
 */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const PRIVATE = "Synthetic private words: Mum's morphine dose was missed tonight";

/** Whether the thrown error (message, cause or stack) holds the private text. */
const carries = (e: unknown) => {
  const err = e as Error & { cause?: Error };
  return [err.message, err.stack, err.cause?.message, err.cause?.stack].some((x) => x?.includes(PRIVATE));
};

async function loggedLineFor(fail: () => Promise<unknown>) {
  let error: unknown;
  try {
    await fail();
  } catch (e) {
    error = e;
  }
  expect(error, "the query should have failed").toBeDefined();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  reportError(error, "T19TEST1");
  const raw = spy.mock.calls.map((c) => String(c[0]));
  spy.mockRestore();
  expect(raw).toHaveLength(1);
  return { error, raw: raw[0]!, line: JSON.parse(raw[0]!) as Record<string, string> };
}

describe("error output after a real database failure", () => {
  it("drops the query's parameters from a failed insert, and keeps the database's reason", async () => {
    const { error, raw, line } = await loggedLineFor(() =>
      // A message in a household and thread that don't exist: the foreign keys refuse it.
      t.db.insert(s.messages).values({
        tenantId: "tn-none",
        householdId: "hh-none",
        threadId: "th-none",
        authorActorId: "ac-none",
        body: PRIVATE,
      } as never),
    );
    // The thrown error itself does carry the text: that's what the redaction is for.
    expect(carries(error)).toBe(true);
    expect(raw).not.toContain(PRIVATE);
    expect(raw).not.toContain("morphine");
    expect(line.ref).toBe("T19TEST1");
    expect(`${line.message} ${line.cause ?? ""}`).toMatch(/violates|constraint|null value|does not exist/i);
  });

  it("drops parameters from a failed update too", async () => {
    const { error, raw } = await loggedLineFor(() =>
      t.db
        .update(s.messages)
        .set({ body: PRIVATE, tenantId: null } as never)
        .where(undefined as never),
    );
    expect(carries(error)).toBe(true);
    expect(raw).not.toContain(PRIVATE);
  });
});
