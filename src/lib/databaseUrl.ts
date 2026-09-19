/** Single source of truth for the local SQLite file location, so the app
 * runtime (src/lib/db.ts) and the standalone seed script (prisma/seed.ts)
 * can never drift out of sync with each other or with .env.example. */
export const DATABASE_URL = process.env.DATABASE_URL ?? "file:./dev.db";
