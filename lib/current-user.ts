import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "./db/client";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { keyHint, userGeminiKey } from "./user-gemini";
import { resolveSettings } from "./validation";

/** The logged-in user for server components (null when logged out). Deduped per request. */
export const getCurrentUser = cache(async () => {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.sub)).limit(1);
  if (!user) return null;
  const key = userGeminiKey(user);
  return {
    id: user.id,
    username: user.username,
    settings: resolveSettings(user.settings),
    hasGeminiKey: Boolean(key),
    geminiKeyHint: keyHint(key),
  };
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
