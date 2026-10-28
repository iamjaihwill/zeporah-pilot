import { describe, expect, it } from "vitest";
import { parseAddresses } from "@/domain/addresses";
import { crossSiteRefusal, type OriginCheck } from "@/domain/same-origin";

const live = parseAddresses("https://app.zeporah.co", "https://care.zeporah.co");
const req = (over: Partial<OriginCheck>): OriginCheck => ({
  method: "POST",
  host: "localhost:3000",
  origin: null,
  secFetchSite: null,
  addresses: null,
  ...over,
});

describe("cross-site refusal (PB-06)", () => {
  it("never refuses a read", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"])
      expect(
        crossSiteRefusal(req({ method, origin: "https://evil.example", secFetchSite: "cross-site" })),
      ).toBeNull();
  });

  it("refuses a change from another origin, on every method that changes something", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"])
      expect(crossSiteRefusal(req({ method, origin: "https://evil.example" }))).toBe("foreign_origin");
    expect(crossSiteRefusal(req({ origin: "http://localhost:3001" }))).toBe("foreign_origin");
    expect(crossSiteRefusal(req({ origin: "null" }))).toBe("foreign_origin");
    expect(crossSiteRefusal(req({ origin: "not a url" }))).toBe("foreign_origin");
  });

  it("allows a change from this server or a configured address", () => {
    expect(crossSiteRefusal(req({ origin: "http://localhost:3000" }))).toBeNull();
    expect(crossSiteRefusal(req({ origin: "http://LOCALHOST:3000", secFetchSite: "cross-site" }))).toBeNull();
    const behindBalancer = { host: "app.zeporah.co", addresses: live };
    expect(crossSiteRefusal(req({ ...behindBalancer, origin: "https://app.zeporah.co" }))).toBeNull();
    expect(crossSiteRefusal(req({ ...behindBalancer, origin: "https://care.zeporah.co" }))).toBeNull();
    // A sibling subdomain shares the site but isn't one of Zeporah's addresses.
    expect(crossSiteRefusal(req({ ...behindBalancer, origin: "https://www.zeporah.co" }))).toBe(
      "foreign_origin",
    );
  });

  it("uses fetch metadata when there's no Origin header", () => {
    expect(crossSiteRefusal(req({ secFetchSite: "cross-site" }))).toBe("cross_site");
    expect(crossSiteRefusal(req({ secFetchSite: "same-site" }))).toBe("cross_site");
    expect(crossSiteRefusal(req({ secFetchSite: "same-origin" }))).toBeNull();
    expect(crossSiteRefusal(req({ secFetchSite: "none" }))).toBeNull();
  });

  it("allows a request with neither header (not a browser)", () => {
    expect(crossSiteRefusal(req({}))).toBeNull();
  });
});
