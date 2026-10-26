import { eq } from "drizzle-orm";
import { ApiError, ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { verifyGeminiKey } from "@/lib/gemini";
import { rateLimit } from "@/lib/rate-limit";
import { seal } from "@/lib/secret-box";
import { keyHint } from "@/lib/user-gemini";
import { geminiKeySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Save the user's own Gemini API key after checking it with Google. Stored encrypted; never returned. */
export const PUT = route(async (req) => {
  const user = await requireUser(req);
  const { apiKey } = await parseJson(req, geminiKeySchema);
  await rateLimit(`gemini-key:${user.id}`, 10, 10 * 60_000);
  const check = await verifyGeminiKey(apiKey);
  if (check === "invalid") {
    throw new ApiError(400, "invalid_key", "Google rejected this key. Copy it again from Google AI Studio.", {
      apiKey: "Google rejected this key. Copy it again from Google AI Studio.",
    });
  }
  if (check === "unreachable") {
    throw new ApiError(502, "unreachable", "Couldn't reach Google to check the key. Please try again.");
  }
  const db = await getDb();
  await db.update(schema.users).set({ geminiKeyEnc: seal(apiKey) }).where(eq(schema.users.id, user.id));
  return ok({ hasKey: true, hint: keyHint(apiKey) });
});

export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  await db.update(schema.users).set({ geminiKeyEnc: null }).where(eq(schema.users.id, user.id));
  return ok({ hasKey: false, hint: null });
});
