import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { securityHeaders } from "./src/domain/security-headers";

// Local development only. There is deliberately no deployment target configured.
export default defineConfig({
  // Static files skip the app's request middleware (src/start.ts), so the dev server adds the same
  // security headers to them (PB-05). In production, static files get them from the edge.
  server: { port: 3000, strictPort: true, headers: securityHeaders({ https: false }) },
  // End-to-end tests use their own cache folder (ZEPORAH_VITE_CACHE) so a cold-cache run never
  // touches the cache used by the ordinary dev server.
  cacheDir: process.env["ZEPORAH_VITE_CACHE"] ?? "node_modules/.vite",
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
  // PGlite ships WebAssembly and must not be pre-bundled.
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  ssr: { external: ["@electric-sql/pglite"] },
});
