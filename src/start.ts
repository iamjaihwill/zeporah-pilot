import { createMiddleware, createStart } from "@tanstack/react-start";
import { redirectFor } from "@/domain/addresses";

/**
 * Sends each page to its own address (domain/addresses.ts): family pages to the app address, the
 * staff workspace to the care address, and the care address's root to the staff sign-in. Does
 * nothing unless ZEPORAH_APP_URL and ZEPORAH_CARE_URL are set.
 */
const addressRedirect = createMiddleware().server(async ({ request, next }) => {
  const { addresses } = await import("@/server/environment");
  const url = new URL(request.url);
  // Behind the load balancer the original address arrives as X-Forwarded-Host.
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const to = redirectFor(addresses(), host, `${url.pathname}${url.search}`);
  if (to && (request.method === "GET" || request.method === "HEAD"))
    return new Response(null, { status: 307, headers: { Location: to } });
  return next();
});

export const startInstance = createStart(() => ({ requestMiddleware: [addressRedirect] }));
