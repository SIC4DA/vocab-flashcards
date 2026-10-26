import { ApiError, ok, parseJson, requireUser, route } from "@/lib/api";
import { userGeminiKey } from "@/lib/user-gemini";
import { geminiGenerateDeck } from "@/lib/gemini";
import { geminiRateLimit } from "@/lib/rate-limit";
import { generateDeckSchema, generatedCardsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 25;

/** Gemini-generated cards for review in the editor (nothing is saved here). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const key = userGeminiKey(user);
  if (!key) throw new ApiError(404, "no_gemini_key", "Add your Gemini API key in Settings to use this feature");
  const { topic, termLang, definitionLang, count } = await parseJson(req, generateDeckSchema);
  await geminiRateLimit(user.id);
  let raw: unknown;
  try {
    raw = await geminiGenerateDeck(key, topic, termLang, definitionLang, count);
  } catch (err) {
    console.warn("Gemini generate failed:", err instanceof Error ? err.message : err);
    throw new ApiError(502, "generate_failed", "Couldn't generate cards right now. Please try again.");
  }
  const list = Array.isArray(raw) ? raw : (raw as { cards?: unknown })?.cards;
  const parsed = generatedCardsSchema.safeParse(Array.isArray(list) ? list.slice(0, count) : list);
  if (!parsed.success) throw new ApiError(502, "generate_failed", "The generated cards were invalid. Please try again.");
  return ok({ cards: parsed.data });
});
