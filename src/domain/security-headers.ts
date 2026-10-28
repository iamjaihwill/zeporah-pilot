/**
 * The security-header baseline (pilot blocker PB-05), set on every response by src/start.ts. None
 * of it depends on the hosting choice: Zeporah loads nothing from another site (no fonts, CDNs,
 * frames or analytics), so everything is limited to its own address.
 *
 * Known gap: inline scripts are allowed (`'unsafe-inline'`), because server rendering writes its
 * hydration data as inline scripts and the development server adds its own. The router can stamp
 * a per-request nonce on its scripts (`ssr.nonce`); switching to that needs a production build to
 * test against, so it's left for later. Inline styles are allowed for the style props in the
 * charts, which are low risk.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // 'self' covers the development server's live-reload connection on the same address.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** One year. Sent only on https, where a browser honours it (see `securityHeaders`). */
export const HSTS = "max-age=31536000; includeSubDomains";

/** The headers for one response. `https`: whether the request arrived over https. */
export function securityHeaders({ https }: { https: boolean }): Record<string, string> {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    // The full address never leaves Zeporah: links within it keep it, links elsewhere get nothing.
    "Referrer-Policy": "same-origin",
    // For browsers that predate frame-ancestors.
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...(https ? { "Strict-Transport-Security": HSTS } : {}),
  };
}
