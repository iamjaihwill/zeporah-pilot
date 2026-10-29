import { createMiddleware, createStart } from "@tanstack/react-start";
import { redirectFor } from "@/domain/addresses";
import { crossSiteRefusal } from "@/domain/same-origin";
import { securityHeaders } from "@/domain/security-headers";

/** The address the request arrived on. Behind the load balancer it comes as X-Forwarded-Host. */
const hostOf = (request: Request) =>
  request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || new URL(request.url).host;

/**
 * Puts the security-header baseline (domain/security-headers.ts, PB-05) on every response, including
 * refusals and redirects from the checks below. HSTS only when the request arrived over https
 * (behind the load balancer, X-Forwarded-Proto says so).
 */
const headers = createMiddleware().server(async ({ request, next }) => {
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(request.url).protocol;
  const add = securityHeaders({ https: proto.replace(/:$/, "") === "https" });
  let result: Awaited<ReturnType<typeof next>>;
  try {
    result = await next();
  } catch (e) {
    // An error the framework raises before any handler runs (an unknown server function address,
    // for one) would otherwise reach the browser as the framework's own 500 without these headers.
    // Send the same reply, with them. A thrown Response (a redirect) keeps its status and body.
    let response: Response;
    if (e instanceof Response)
      response = new Response(e.body, { status: e.status, statusText: e.statusText, headers: e.headers });
    else {
      // Through the observability hook, which drops query parameters (they can hold what someone
      // typed), never straight to the console.
      const { newReference, reportError } = await import("@/server/observability");
      reportError(e, newReference());
      response = Response.json({ status: 500, unhandled: true, message: "HTTPError" }, { status: 500 });
    }
    for (const [k, v] of Object.entries(add)) response.headers.set(k, v);
    return response;
  }
  // No response yet (the framework reports that itself): nothing to add headers to.
  if (!result.response) return result;
  try {
    for (const [k, v] of Object.entries(add)) result.response.headers.set(k, v);
    return result;
  } catch {
    // Some responses come with headers that can't be changed: copy them into a new one.
    const h = new Headers(result.response.headers);
    for (const [k, v] of Object.entries(add)) h.set(k, v);
    const { status, statusText, body } = result.response;
    return { ...result, response: new Response(body, { status, statusText, headers: h }) };
  }
});

/**
 * Refuses a change sent from another site (domain/same-origin.ts, PB-06). Every request passes
 * here, server functions included, so no write path can miss it. Nothing is changed or logged
 * with request data; the refusal names no reason.
 */
const sameOrigin = createMiddleware().server(async ({ request, next }) => {
  const { addresses } = await import("@/server/environment");
  const refused = crossSiteRefusal({
    method: request.method,
    host: hostOf(request),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    addresses: addresses(),
  });
  if (refused)
    return Response.json(
      { error: "This change has to come from Zeporah itself. Nothing was changed." },
      { status: 403 },
    );
  return next();
});

/**
 * Sends each page to its own address (domain/addresses.ts): family pages to the app address, the
 * staff workspace to the care address, and the care address's root to the staff sign-in. Does
 * nothing unless ZEPORAH_APP_URL and ZEPORAH_CARE_URL are set.
 */
const addressRedirect = createMiddleware().server(async ({ request, next }) => {
  const { addresses } = await import("@/server/environment");
  const url = new URL(request.url);
  const to = redirectFor(addresses(), hostOf(request), `${url.pathname}${url.search}`);
  if (to && (request.method === "GET" || request.method === "HEAD"))
    return new Response(null, { status: 307, headers: { Location: to } });
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [headers, sameOrigin, addressRedirect],
}));
