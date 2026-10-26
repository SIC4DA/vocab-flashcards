/**
 * Applies Drizzle migrations from ./drizzle. Runs before `next build` (and so on every Vercel deploy).
 * Idempotent: Drizzle records applied migrations in its own table and skips them.
 * Without DATABASE_URL it does nothing — the embedded PGlite database migrates itself at runtime.
 */
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrate] DATABASE_URL not set — skipping (local PGlite applies migrations on first use).");
    return;
  }
  const [{ drizzle }, { migrate }, { neonConfig }, ws] = await Promise.all([
    import("drizzle-orm/neon-serverless"),
    import("drizzle-orm/neon-serverless/migrator"),
    import("@neondatabase/serverless"),
    import("ws"),
  ]);
  neonConfig.webSocketConstructor = ws.default;
  const db = drizzle({ connection: url });
  console.log("[migrate] Applying migrations…");
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.$client.end();
  console.log("[migrate] Database is up to date.");
}

main().catch((err) => {
  console.error("[migrate] Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
