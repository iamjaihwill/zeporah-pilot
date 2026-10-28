import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, HSTS, securityHeaders } from "@/domain/security-headers";

const directives = new Map(
  CONTENT_SECURITY_POLICY.split("; ").map((d) => {
    const [name, ...values] = d.split(" ");
    return [name!, values] as const;
  }),
);

describe("security-header baseline (PB-05)", () => {
  it("names every header the pilot evidence plan asks for", () => {
    const h = securityHeaders({ https: true });
    for (const name of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "X-Frame-Options",
      "Permissions-Policy",
    ])
      expect(h[name], name).toBeTruthy();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
  });

  it("sends HSTS only over https", () => {
    expect(securityHeaders({ https: true })["Strict-Transport-Security"]).toBe(HSTS);
    expect(securityHeaders({ https: false })).not.toHaveProperty("Strict-Transport-Security");
  });

  it("limits everything to Zeporah's own address, with no frames, plugins or outside forms", () => {
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    // Nothing from another site, anywhere in the policy.
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:|\*|'unsafe-eval'/);
  });

  it("records the one known weakness: inline scripts are still allowed", () => {
    expect(directives.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });
});
