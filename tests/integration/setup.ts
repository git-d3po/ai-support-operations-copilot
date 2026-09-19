// Integration tests use the real Prisma client (src/lib/db.ts), which reads
// DATABASE_URL from process.env — unlike Next.js, Vitest doesn't load .env
// automatically.
import "dotenv/config";
