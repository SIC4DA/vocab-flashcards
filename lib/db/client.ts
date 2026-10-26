import "server-only";
import path from "node:path";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { ConfigError } from "../env";

/**
 * One database handle per server instance.
 * - `DATABASE_URL` set → Neon serverless driver (WebSocket pool; supports transactions).
 * - otherwise → PGlite (embedded Postgres). Persists to `PGLITE_DIR` (default `.pglite/`),
 *   or stays in memory when `PGLITE_DIR=memory://`. Migrations are applied on first use.
 */
export type DB = NeonDatabase<typeof schema>;

type Holder = { promise?: Promise<DB> };
const g = globalThis as unknown as { __vocabDb?: Holder };
const holder: Holder = (g.__vocabDb ??= {});

export const migrationsFolder = path.join(process.cwd(), "drizzle");

async function createNeon(url: string): Promise<DB> {
  const [{ drizzle }, { neonConfig, Pool }, ws] = await Promise.all([
    import("drizzle-orm/neon-serverless"),
    import("@neondatabase/serverless"),
    import("ws"),
  ]);
  neonConfig.webSocketConstructor = ws.default;
  // Small pool, short idle timeout: serverless instances freeze between requests and Neon
  // may drop idle sockets. Errors on idle clients must not crash the process.
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 });
  pool.on("error", (err: Error) => console.warn("Postgres pool error:", err.message));
  return drizzle({ client: pool, schema });
}

async function createPglite(): Promise<DB> {
  const [{ drizzle }, { migrate }, { PGlite }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("@electric-sql/pglite"),
  ]);
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".pglite");
  const client = dir === "memory://" ? new PGlite() : new PGlite(dir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!holder.promise) {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.VERCEL) {
      // The embedded database can't write to Vercel's read-only filesystem.
      return Promise.reject(
        new ConfigError(
          "DATABASE_URL is not set. In Vercel open your project → Storage → create/connect a Neon database, then redeploy.",
        ),
      );
    }
    holder.promise = (url ? createNeon(url) : createPglite()).catch((err) => {
      holder.promise = undefined;
      throw err;
    });
  }
  return holder.promise;
}

/** Test helper: drop the cached handle so the next getDb() creates a fresh database. */
export function resetDbForTests() {
  holder.promise = undefined;
}

export { schema };
