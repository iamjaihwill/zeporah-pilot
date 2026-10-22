/**
 * Secrets handling for sign-in, sessions and invitations. Uses only Node's built-in crypto, so it
 * runs the same under Bun and Node and adds no dependency.
 *
 * - Passwords: scrypt (memory-hard), OWASP baseline parameters (N=2^17, r=8, p=1), 16-byte random
 *   salt, 64-byte key, stored as "scrypt$N$r$p$salt$hash". Compared in constant time.
 * - Tokens (session cookies, invitation links): 32 random bytes; only their SHA-256 is stored.
 */
import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;
/** scrypt needs about 128·N·r bytes; leave headroom. */
const MAXMEM = 256 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * A real hash of a random password, used when an email has no account so that a failed sign-in
 * takes about as long whether or not the account exists.
 */
let dummy: Promise<string> | null = null;
export const dummyPasswordHash = () => (dummy ??= hashPassword(randomBytes(24).toString("base64")));

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
/** Deliberately simple: one "@", something on each side, a dot in the domain, no spaces. */
export const looksLikeEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
