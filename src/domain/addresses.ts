/**
 * Public addresses (docs/architecture/environments.md, "Addresses"). One server answers on two
 * addresses: families use the app address (app.zeporah.co) and hospice teams the care address
 * (care.zeporah.co). Sign-in cookies are tied to the address they were set on, so each page has to
 * open on its own address, and every link sent outside Zeporah has to name the right one.
 *
 * With no addresses configured (local, test and demo) nothing redirects and links stay paths.
 */

export type Area = "app" | "care";
export type Addresses = Record<Area, URL>;

/** Pages that belong to one address. Anything not listed (/, /invite, /info, assets, server functions) opens on either. */
const AREAS: Record<Area, string[]> = {
  app: ["/family", "/helper", "/create-account", "/forgot-password", "/reset"],
  care: ["/staff", "/staff-sign-in", "/recipient"],
};

/** The care address's start page: its root is the staff sign-in, not the family one. */
export const CARE_START = "/staff-sign-in";

export function areaOf(pathname: string): Area | null {
  for (const area of ["app", "care"] as const)
    if (AREAS[area].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return area;
  return null;
}

/**
 * Reads the two addresses. Both or neither: one alone is a configuration mistake. Each must be an
 * origin only (no path), https outside local testing, and the two must differ.
 */
export function parseAddresses(app: string | undefined, care: string | undefined): Addresses | null {
  const a = app?.trim();
  const c = care?.trim();
  if (!a && !c) return null;
  if (!a || !c) throw new Error("Set both ZEPORAH_APP_URL and ZEPORAH_CARE_URL, or neither.");
  const parse = (name: string, value: string) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} isn't a web address: "${value}".`);
    }
    const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost");
    if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
      throw new Error(`${name} must use https.`);
    if (url.pathname !== "/" || url.search || url.hash)
      throw new Error(`${name} must be an address only, with no path: "${value}".`);
    return url;
  };
  const addresses = { app: parse("ZEPORAH_APP_URL", a), care: parse("ZEPORAH_CARE_URL", c) };
  if (addresses.app.host === addresses.care.host)
    throw new Error("ZEPORAH_APP_URL and ZEPORAH_CARE_URL must be different addresses.");
  return addresses;
}

/**
 * Where a request should be sent instead, or null to serve it here. Only requests that arrived on
 * one of the two addresses move, and only to the other configured address.
 */
export function redirectFor(addresses: Addresses | null, host: string, path: string): string | null {
  if (!addresses) return null;
  const here = (["app", "care"] as const).find((a) => addresses[a].host === host.toLowerCase());
  if (!here) return null;
  const url = new URL(path, addresses[here]);
  if (here === "care" && url.pathname === "/")
    return new URL(`${CARE_START}${url.search}`, addresses.care).href;
  const area = areaOf(url.pathname);
  return area && area !== here ? new URL(`${url.pathname}${url.search}`, addresses[area]).href : null;
}

/**
 * The link to put in an email or invitation: the full address when addresses are configured,
 * otherwise the path itself. `area` is for pages that open on either address (/invite, /);
 * otherwise the page decides, and anything undecided goes to the app address.
 */
export function publicUrl(addresses: Addresses | null, path: string, area?: Area): string {
  if (!addresses) return path;
  const url = new URL(path, addresses.app);
  return new URL(`${url.pathname}${url.search}${url.hash}`, addresses[areaOf(url.pathname) ?? area ?? "app"])
    .href;
}
