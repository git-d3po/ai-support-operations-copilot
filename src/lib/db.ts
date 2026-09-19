import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { DATABASE_URL } from "@/lib/databaseUrl";

// Standard Next.js pattern: reuse a single PrismaClient across hot reloads in
// development so we don't exhaust SQLite connections on every file save.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma 7 requires an explicit driver adapter — there is no implicit
// env-based connection in the generated client. See DECISIONS.md ("Why
// SQLite for synthetic data").
const adapter = new PrismaBetterSqlite3({ url: DATABASE_URL });

export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
