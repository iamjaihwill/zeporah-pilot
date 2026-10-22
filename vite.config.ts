import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Local development only. There is deliberately no deployment target configured.
export default defineConfig({
  server: { port: 3000, strictPort: true },
  // End-to-end tests use their own cache folder (ZEPORAH_VITE_CACHE) so a cold-cache run never
  // touches the cache used by the ordinary dev server.
  cacheDir: process.env["ZEPORAH_VITE_CACHE"] ?? "node_modules/.vite",
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
  // PGlite ships WebAssembly and must not be pre-bundled.
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  ssr: { external: ["@electric-sql/pglite"] },
});
