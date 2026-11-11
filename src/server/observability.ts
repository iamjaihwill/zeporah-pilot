/**
 * The observability hook: one structured JSON line per unexpected server error, to the server's
 * own output. No external vendor, and no request data. Only approved diagnostic fields are written
 * (threat T19, correction L1, 2026-10-29): never an error's message or its cause's message, which
 * can quote what someone typed (a database type error quotes the value; a thrown string is
 * whatever it says).
 *
 * The fields: level, time, the reference the person can quote, the error's type, a category
 * ("database", "error", "non-error", or "unloggable" when nothing could be read), and for a
 * database error the SQLSTATE code and the schema names involved (constraint, table, column),
 * which are identifiers and never values. The stack keeps call-frame locations only (file, line,
 * column), never the message or a function name.
 *
 * Whatever is thrown controls every property of itself, so each field is read through a guard,
 * checked against a fixed list or a strict shape, and limited in length (correction L6,
 * 2026-11-11). The logger never throws, and never writes the value it was given.
 */
import { randomBytes } from "node:crypto";
import { getTableName, isTable } from "drizzle-orm";
import * as schema from "./db/schema";

export const newReference = () => randomBytes(4).toString("hex").toUpperCase();

const REFERENCE = /^[0-9A-F]{8}$/;
/** A SQLSTATE code in one of Postgres's classes (so "EPERM" and the like aren't taken for one). */
const SQLSTATE = /^(0[0-3]|0[89ABFLPZ]|2[0-8BDF]|3[489BDF]|4[024]|5[3-578]|72|F0|HV|P0|XX)[0-9A-Z]{3}$/;
/** A Postgres identifier as the schema uses them: never a quoted value. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
/** The error types written by name; any other error is written as "Error". */
const TYPES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
  "AccessError",
  "IntegrationNotConnected",
  "DrizzleError",
  "DrizzleQueryError",
]);
const MAX_FRAMES = 6;
const MAX_FRAME = 300;

let tables: Set<string> | undefined;
/** The schema's table names. A column or constraint can't be checked this way: an undefined-column
 *  error names a column the schema doesn't have. */
const schemaTables = () =>
  (tables ??= new Set(
    Object.values(schema)
      .filter(isTable)
      .map((t) => getTableName(t)),
  ));

type Diagnostic = {
  level: "error";
  at: string;
  ref: string;
  type: string;
  category: "database" | "error" | "non-error" | "unloggable";
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  stack?: string;
};

/** A property, or undefined if reading it throws (a getter, a proxy). */
function read(o: unknown, key: string): unknown {
  try {
    return (o as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function isError(e: unknown): e is Error {
  try {
    return e instanceof Error;
  } catch {
    return false;
  }
}

/** The database's own fields from an error or its cause, kept only when they are codes or names. */
function databaseFields(e: unknown): Pick<Diagnostic, "code" | "constraint" | "table" | "column"> | null {
  for (const candidate of [e, isError(e) ? read(e, "cause") : undefined]) {
    if (!candidate || typeof candidate !== "object") continue;
    const code = read(candidate, "code");
    if (typeof code !== "string" || !SQLSTATE.test(code)) continue;
    const name = (k: "constraint" | "column") => {
      const v = read(candidate, k);
      return typeof v === "string" && IDENTIFIER.test(v) ? { [k]: v } : {};
    };
    const table = read(candidate, "table");
    return {
      code,
      ...name("constraint"),
      ...(typeof table === "string" && schemaTables().has(table) ? { table } : {}),
      ...name("column"),
    };
  }
  return null;
}

/** "/path/file.ts:12:3", "file:///…:12:3" or "node:internal/…:12:3": a location and nothing else. */
const LOCATION = /^(?:\/|file:\/\/|node:)[^\n]*:\d+:\d+$/;

/**
 * Call-frame locations only. The message is cut off first, wherever it is in the stack, so a
 * message line shaped like a frame can't pass; a stack that doesn't contain the message keeps no
 * frames at all. Of each frame only the location is kept, at most six, each at most 300 characters.
 */
function frames(e: Error): string | undefined {
  const stack = read(e, "stack");
  const message = read(e, "message");
  if (typeof stack !== "string" || typeof message !== "string") return undefined;
  const at = stack.indexOf(message);
  if (at < 0) return undefined;
  const cwd = `${process.cwd()}/`;
  const kept: string[] = [];
  for (const line of stack.slice(at + message.length).split("\n")) {
    if (kept.length === MAX_FRAMES) break;
    // "at name (location)" (the first parenthesis: paths can hold their own) or "at location".
    const m = /^\s+at (?:[^(]*\((.+)\)|(?:async )?(.+))$/.exec(line);
    const raw = m?.[1] ?? m?.[2];
    if (!raw || !LOCATION.test(raw)) continue;
    // Inside the project, the path from its root is enough.
    const location = raw.startsWith(cwd) ? raw.slice(cwd.length) : raw;
    if (location.length <= MAX_FRAME) kept.push(`    at ${location}`);
  }
  return kept.join("\n") || undefined;
}

export function diagnostic(e: unknown, ref: string): Diagnostic {
  const err = isError(e) ? e : null;
  const db = databaseFields(e);
  const name = err ? read(err, "name") : undefined;
  const stack = err ? frames(err) : undefined;
  return {
    level: "error",
    at: new Date().toISOString(),
    ref: typeof ref === "string" && REFERENCE.test(ref) ? ref : "INVALID",
    type: err ? (typeof name === "string" && TYPES.has(name) ? name : "Error") : typeof e,
    category: db ? "database" : err ? "error" : "non-error",
    ...(db ?? {}),
    ...(stack ? { stack } : {}),
  };
}

export function reportError(e: unknown, ref: string) {
  let line: string;
  try {
    line = JSON.stringify(diagnostic(e, ref));
  } catch {
    // Nothing from the value: a fixed line, so the reference is still on record.
    line = JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      ref: typeof ref === "string" && REFERENCE.test(ref) ? ref : "INVALID",
      type: "Unknown",
      category: "unloggable",
    } satisfies Diagnostic);
  }
  console.error(line);
}

/** Drop a "params: …" line (query parameters can hold what someone typed). */
export const withoutParams = (msg: string) =>
  msg.replace(/\nparams:[\s\S]*$/, "").replace(/^params:.*$/m, "");
