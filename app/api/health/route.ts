import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { ConfigError } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  let db = false;
  let error: string | undefined;
  try {
    const conn = await getDb();
    await conn.execute(sql`select 1`);
    db = true;
  } catch (err) {
    console.error("Health check DB error:", err instanceof Error ? err.message : err);
    error = err instanceof ConfigError ? err.message : "Database unreachable";
  }
  return NextResponse.json({ ok: db, db, ...(error ? { error } : {}) }, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
