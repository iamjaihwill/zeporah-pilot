import { afterEach, describe, expect, it, vi } from "vitest";
import { areaOf, parseAddresses, publicUrl, redirectFor } from "@/domain/addresses";
import { addresses, assertEnvironment } from "@/server/environment";
import { emailLink } from "@/server/mail";

afterEach(() => vi.unstubAllEnvs());

const live = parseAddresses("https://app.zeporah.co", "https://care.zeporah.co");

describe("areas", () => {
  it("puts family pages on the app address and the staff workspace and recipients on the care address", () => {
    expect(areaOf("/family")).toBe("app");
    expect(areaOf("/family/vault/v1")).toBe("app");
    expect(areaOf("/helper")).toBe("app");
    expect(areaOf("/reset/abc")).toBe("app");
    expect(areaOf("/staff")).toBe("care");
    expect(areaOf("/staff-sign-in")).toBe("care");
    expect(areaOf("/recipient/setup/abc")).toBe("care");
    // Either address: the start page, invitations, information pages, server functions, assets.
    for (const p of ["/", "/invite/abc", "/info/privacy", "/_serverFn/x", "/images/a.jpg", "/familyish"])
      expect(areaOf(p)).toBeNull();
  });
});

describe("parseAddresses", () => {
  it("is off when neither is set, and refuses half or malformed settings", () => {
    expect(parseAddresses(undefined, " ")).toBeNull();
    expect(() => parseAddresses("https://app.zeporah.co", undefined)).toThrow(/both/);
    expect(() => parseAddresses("http://app.zeporah.co", "https://care.zeporah.co")).toThrow(/https/);
    expect(() => parseAddresses("https://app.zeporah.co/x", "https://care.zeporah.co")).toThrow(/no path/);
    expect(() => parseAddresses("app.zeporah.co", "https://care.zeporah.co")).toThrow(/web address/);
    expect(() => parseAddresses("https://zeporah.co", "https://zeporah.co")).toThrow(/different/);
    expect(parseAddresses("http://app.localhost:3000", "http://care.localhost:3000")).not.toBeNull();
  });
});

describe("redirectFor", () => {
  it("opens the staff sign-in at the care address's root", () => {
    expect(redirectFor(live, "care.zeporah.co", "/")).toBe("https://care.zeporah.co/staff-sign-in");
    expect(redirectFor(live, "care.zeporah.co", "/?next=%2Fstaff%2Fqueue")).toBe(
      "https://care.zeporah.co/staff-sign-in?next=%2Fstaff%2Fqueue",
    );
    expect(redirectFor(live, "app.zeporah.co", "/")).toBeNull();
  });

  it("sends each page to its own address, keeping the query", () => {
    expect(redirectFor(live, "app.zeporah.co", "/staff/tasks?view=mine")).toBe(
      "https://care.zeporah.co/staff/tasks?view=mine",
    );
    expect(redirectFor(live, "care.zeporah.co", "/family/messages")).toBe(
      "https://app.zeporah.co/family/messages",
    );
    expect(redirectFor(live, "APP.zeporah.co", "/staff-sign-in")).toBe(
      "https://care.zeporah.co/staff-sign-in",
    );
  });

  it("leaves pages on their own address, shared pages, other hosts and unconfigured servers alone", () => {
    expect(redirectFor(live, "app.zeporah.co", "/family")).toBeNull();
    expect(redirectFor(live, "care.zeporah.co", "/staff")).toBeNull();
    expect(redirectFor(live, "care.zeporah.co", "/invite/abc")).toBeNull();
    expect(redirectFor(live, "app.zeporah.co", "/_serverFn/abc")).toBeNull();
    expect(redirectFor(live, "staging.internal", "/staff")).toBeNull();
    expect(redirectFor(null, "care.zeporah.co", "/")).toBeNull();
  });
});

describe("publicUrl", () => {
  it("names the address each page opens on, or keeps the path when none are set", () => {
    expect(publicUrl(live, "/reset/abc")).toBe("https://app.zeporah.co/reset/abc");
    expect(publicUrl(live, "/family/messages#entry-1")).toBe(
      "https://app.zeporah.co/family/messages#entry-1",
    );
    expect(publicUrl(live, "/recipient/setup/abc")).toBe("https://care.zeporah.co/recipient/setup/abc");
    expect(publicUrl(live, "/invite/abc", "care")).toBe("https://care.zeporah.co/invite/abc");
    expect(publicUrl(live, "/invite/abc", "app")).toBe("https://app.zeporah.co/invite/abc");
    expect(publicUrl(live, "/")).toBe("https://app.zeporah.co/");
    expect(publicUrl(null, "/reset/abc")).toBe("/reset/abc");
  });
});

describe("environment", () => {
  it("reads the addresses, uses them for email links, and refuses to start when they're wrong", () => {
    vi.stubEnv("ZEPORAH_APP_URL", "");
    vi.stubEnv("ZEPORAH_CARE_URL", "");
    expect(addresses()).toBeNull();
    expect(emailLink({ link: "/reset/abc" })).toBe("/reset/abc");
    vi.stubEnv("ZEPORAH_APP_URL", "https://app.zeporah.co");
    vi.stubEnv("ZEPORAH_CARE_URL", "https://care.zeporah.co");
    expect(emailLink({ link: "/recipient" })).toBe("https://care.zeporah.co/recipient");
    expect(() => assertEnvironment()).not.toThrow();
    vi.stubEnv("ZEPORAH_CARE_URL", "");
    expect(() => assertEnvironment()).toThrow(/ZEPORAH_CARE_URL/);
  });
});
