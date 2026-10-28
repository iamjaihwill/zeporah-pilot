import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { forgetUncertain, isOffline, rememberUncertain, resetUncertainCache } from "@/lib/connection";

/** Offline tolerance in the browser (founder decisions 84–87), with storage and the connection faked. */
const KEY = "zeporah.uncertain-sends";
let store: Map<string, string>;
const stored = () => JSON.parse(store.get(KEY) ?? "[]") as Record<string, unknown>[];

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  resetUncertainCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("connection (decision 84)", () => {
  it("follows the browser's view", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOffline()).toBe(true);
    vi.stubGlobal("navigator", { onLine: true });
    expect(isOffline()).toBe(false);
  });
});

describe("sends we couldn't confirm (decision 86)", () => {
  it("keeps only the ID, the kind of send and when, once each", () => {
    rememberUncertain({ id: "11111111-1111-4111-8111-111111111111", kind: "message" });
    rememberUncertain({ id: "11111111-1111-4111-8111-111111111111", kind: "message" });
    const [u] = stored();
    expect(stored()).toHaveLength(1);
    expect(Object.keys(u!).sort()).toEqual(["at", "id", "kind"]);
  });

  it("forgets a send once it's settled, and clears the storage when none are left", () => {
    rememberUncertain({ id: "a".repeat(16), kind: "message" });
    rememberUncertain({ id: "b".repeat(16), kind: "request" });
    forgetUncertain(["a".repeat(16)]);
    expect(stored().map((x) => x.id)).toEqual(["b".repeat(16)]);
    forgetUncertain(["b".repeat(16)]);
    expect(store.has(KEY)).toBe(false);
  });

  it("survives a reload, ignores anything malformed, and keeps at most 20", () => {
    store.set(KEY, JSON.stringify([{ id: "c".repeat(16), kind: "message", at: 1 }, { id: 3 }, "x"]));
    resetUncertainCache();
    rememberUncertain({ id: "d".repeat(16), kind: "request" });
    expect(stored().map((x) => x.id)).toEqual(["c".repeat(16), "d".repeat(16)]);
    for (let i = 0; i < 30; i++)
      rememberUncertain({ id: `e${String(i).padStart(15, "0")}`, kind: "message" });
    expect(stored()).toHaveLength(20);
  });

  it("works for the page when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    });
    resetUncertainCache();
    expect(() => rememberUncertain({ id: "f".repeat(16), kind: "message" })).not.toThrow();
  });
});

describe("every tracked send settles through the page (decision 86)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  it("passes the submission ID with every unconfirmed-send message", () => {
    const raw = files("src").filter(
      (f) => !f.endsWith(join("lib", "client.ts")) && readFileSync(f, "utf8").includes("UNCONFIRMED_SEND"),
    );
    expect(raw).toEqual([]);
  });
});

describe("a request that never got an answer", () => {
  it("is recognised by each browser's own words, and nothing else", async () => {
    const { isLostRequest } = await import("@/lib/connection");
    for (const m of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"])
      expect(isLostRequest(new TypeError(m))).toBe(true);
    expect(isLostRequest(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isLostRequest(new Error("Failed to fetch"))).toBe(false);
    expect(isLostRequest("Failed to fetch")).toBe(false);
  });
});
