import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEnvironment, environment } from "@/server/environment";
import { refusedAsReadOnly } from "@/server/rpc";
import { newReference, reportError } from "@/server/observability";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("environment", () => {
  it("reads the mode, name, development gate and read-only flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
    vi.stubEnv("ZEPORAH_READ_ONLY", "1");
    vi.stubEnv("ZEPORAH_ENVIRONMENT", "");
    expect(environment()).toEqual({
      mode: "development",
      name: "development",
      devSignIn: true,
      readOnly: true,
    });
    vi.stubEnv("ZEPORAH_READ_ONLY", "yes");
    expect(environment().readOnly).toBe(false);
  });

  it("refuses production unless the environment is named, and never honours the development gate there", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
    vi.stubEnv("ZEPORAH_ENVIRONMENT", "");
    expect(() => assertEnvironment()).toThrow(/ZEPORAH_ENVIRONMENT/);
    vi.stubEnv("ZEPORAH_ENVIRONMENT", "pilot-staging");
    expect(() => assertEnvironment()).not.toThrow();
    expect(environment()).toMatchObject({ mode: "production", name: "pilot-staging", devSignIn: false });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ZEPORAH_ENVIRONMENT", "");
    expect(() => assertEnvironment()).not.toThrow();
  });
});

describe("read-only mode", () => {
  it("refuses changes (non-GET calls) and nothing else", () => {
    expect(refusedAsReadOnly(true, "POST")).toBe(true);
    expect(refusedAsReadOnly(true, "post")).toBe(true);
    expect(refusedAsReadOnly(true, "GET")).toBe(false);
    expect(refusedAsReadOnly(true, null)).toBe(false);
    expect(refusedAsReadOnly(false, "POST")).toBe(false);
  });
});

describe("error reporting", () => {
  it("writes one structured line with a reference and no request data", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = newReference();
    expect(ref).toMatch(/^[0-9A-F]{8}$/);
    reportError(new TypeError("boom"), ref);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(Object.keys(line).sort()).toEqual(["at", "level", "message", "ref", "stack", "type"]);
    expect(line).toMatchObject({ level: "error", ref, type: "TypeError", message: "boom" });
  });
});
