/**
 * Cross-site request refusal (pilot blocker PB-06). A change may only come from a page Zeporah
 * served: the browser's Origin header must name this server or one of its configured addresses
 * (domain/addresses.ts). Without an Origin header, fetch metadata (Sec-Fetch-Site) decides.
 *
 * A request with neither header didn't come from a modern browser (a test, a script on the same
 * machine). It's allowed, because the attack this blocks, another site making the person's browser
 * send a change with their cookie, always carries one of the two.
 */
import type { Addresses } from "./addresses";

/** Methods that can change something. Reads (GET, HEAD, OPTIONS) are never refused here. */
const CHANGES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type OriginCheck = {
  method: string;
  /** The host the request arrived on (after the load balancer, see src/start.ts). */
  host: string;
  origin: string | null;
  secFetchSite: string | null;
  addresses: Addresses | null;
};

/** Why a request is refused, or null to let it through. */
export function crossSiteRefusal(r: OriginCheck): "foreign_origin" | "cross_site" | null {
  if (!CHANGES.has(r.method.toUpperCase())) return null;
  if (r.origin !== null) {
    let from: URL;
    try {
      from = new URL(r.origin);
    } catch {
      return "foreign_origin"; // includes the opaque "null" origin
    }
    const trusted = [
      r.host.toLowerCase(),
      ...(r.addresses ? [r.addresses.app.host, r.addresses.care.host] : []),
    ];
    return trusted.includes(from.host.toLowerCase()) ? null : "foreign_origin";
  }
  const site = r.secFetchSite?.toLowerCase();
  // "same-site" isn't enough: app and care share a site but are separate addresses, and a sibling
  // subdomain isn't trusted. "none" means the person started it (a bookmark), not another page.
  if (site && site !== "same-origin" && site !== "none") return "cross_site";
  return null;
}
