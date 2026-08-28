import type { Config } from "drizzle-kit";

export default {
  schema: "./src/server/db/schema/index.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/tewsal",
  },
  verbose: true,
  strict: true,
} satisfies Config;
