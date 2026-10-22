/**
 * Sign-in limits and safe return paths, shared by the server and the sign-in pages.
 */

/** After this many failed attempts, sign-in pauses (services/auth.ts). */
export const LOCK_AFTER_FAILURES = 10;
export const LOCK_MINUTES = 15;

/** Where each kind of account may be sent after signing in, besides its home page. */
const RETURN_PREFIXES: Record<string, string[]> = {
  family: ["/family", "/helper"],
  staff: ["/staff"],
  recipient: ["/recipient"],
};

/**
 * The page someone was trying to reach, if it's safe to return them there: a path inside Zeporah
 * (never another site), and one that belongs to their kind of account. Otherwise null.
 */
export function safeReturnPath(next: unknown, kind: string): string | null {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  if (next.length > 500) return null;
  let url: URL;
  try {
    url = new URL(next, "http://zeporah.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://zeporah.invalid") return null;
  const ok = (RETURN_PREFIXES[kind] ?? []).some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  return ok ? `${url.pathname}${url.search}${url.hash}` : null;
}
