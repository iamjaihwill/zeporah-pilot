import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dummyPasswordHash,
  hashPassword,
  hashToken,
  looksLikeEmail,
  newToken,
  normalizeEmail,
  verifyPassword,
} from "@/server/auth/crypto";
import { devSignInEnabled } from "@/server/auth/dev-gate";

afterEach(() => vi.unstubAllEnvs());

describe("password hashing", () => {
  it("hashes with a fresh salt and verifies only the right password", async () => {
    const a = await hashPassword("synthetic-pass-phrase-1");
    const b = await hashPassword("synthetic-pass-phrase-1");
    expect(a).toMatch(/^scrypt\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("synthetic-pass-phrase-1");
    expect(await verifyPassword("synthetic-pass-phrase-1", a)).toBe(true);
    expect(await verifyPassword("synthetic-pass-phrase-2", a)).toBe(false);
  });

  it("treats malformed stored hashes as a mismatch", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", await dummyPasswordHash())).toBe(false);
  });
});

describe("tokens and emails", () => {
  it("makes long random tokens and stores a one-way digest", () => {
    const t = newToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it("normalizes and checks emails", () => {
    expect(normalizeEmail("  Luis@Example.INVALID ")).toBe("luis@example.invalid");
    expect(looksLikeEmail("luis@example.invalid")).toBe(true);
    expect(looksLikeEmail("555-0100")).toBe(false);
  });
});

describe("development gate", () => {
  it("is on only with ZEPORAH_DEV_SIGN_IN=1 outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "");
    expect(devSignInEnabled()).toBe(false);
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "true");
    expect(devSignInEnabled()).toBe(false);
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
    expect(devSignInEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(devSignInEnabled()).toBe(false);
  });
});
