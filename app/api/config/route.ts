import { eq } from "drizzle-orm";
import { ok, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { signupsAllowed } from "@/lib/env";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { userGeminiKey } from "@/lib/user-gemini";

export const runtime = "nodejs";

/** Which optional features are on for the current visitor. `gemini` = this user saved their own key. */
export const GET = route(async (req) => {
  let gemini = false;
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    const db = await getDb();
    const [user] = await db
      .select({ geminiKeyEnc: schema.users.geminiKeyEnc })
      .from(schema.users)
      .where(eq(schema.users.id, session.sub))
      .limit(1);
    gemini = Boolean(user && userGeminiKey(user));
  }
  return ok({ gemini, signups: signupsAllowed() });
});
