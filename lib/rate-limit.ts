import "server-only";
import { and, count, eq, gte, lt } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { ApiError } from "./api";

/**
 * DB-backed sliding-window rate limit (serverless instances share no memory).
 * Throws a 429 ApiError when `limit` events already happened within `windowMs`.
 */
export async function rateLimit(bucket: string, limit: number, windowMs: number) {
  const db = await getDb();
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({ n: count() })
    .from(schema.rateLimitEvents)
    .where(and(eq(schema.rateLimitEvents.bucket, bucket), gte(schema.rateLimitEvents.createdAt, since)));
  if (Number(row?.n ?? 0) >= limit) {
    throw new ApiError(429, "rate_limited", "Too many requests. Please slow down and try again shortly.");
  }
  await db.insert(schema.rateLimitEvents).values({ bucket });
  if (Math.random() < 0.02) {
    await db
      .delete(schema.rateLimitEvents)
      .where(lt(schema.rateLimitEvents.createdAt, new Date(Date.now() - 60 * 60 * 1000)));
  }
}

export const geminiRateLimit = (userId: string) => rateLimit(`gemini:${userId}`, 60, 60_000);
