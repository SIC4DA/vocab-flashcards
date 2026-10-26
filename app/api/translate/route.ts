import { ok, parseJson, requireUser, route } from "@/lib/api";
import { geminiRateLimit } from "@/lib/rate-limit";
import { suggestTranslation } from "@/lib/translate";
import { userGeminiKey } from "@/lib/user-gemini";
import { translateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 25;

/** Suggest a definition for a term. Returns `{translation: null}` when no service could help. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const { text, from, to } = await parseJson(req, translateSchema);
  const key = userGeminiKey(user);
  if (key) await geminiRateLimit(user.id);
  const result = await suggestTranslation(text, from, to, key);
  return ok(result ?? { translation: null });
});
