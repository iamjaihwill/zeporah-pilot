import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from src/server/db/schema.ts. No database URL: migrations are
// applied to the local PGlite database by src/server/db/client.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
});
