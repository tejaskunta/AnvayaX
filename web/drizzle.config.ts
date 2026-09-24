import { defineConfig } from "drizzle-kit";
import path from "node:path";

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? path.join(process.cwd(), "db", "sqlite.db"),
  },
  verbose: true,
  strict: true,
});
