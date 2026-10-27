import { ApiError, ok, parseJson, requireUser, route } from "@/lib/api";
import { getDeckCards, getOwnedDeck } from "@/lib/data";
import { geminiGenerateSentences } from "@/lib/gemini";
import { geminiRateLimit } from "@/lib/rate-limit";
import { userGeminiKey } from "@/lib/user-gemini";
import { generatedSentencesSchema, generateSentencesSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 25;

/** Gemini-written practice sentences that use this deck's words (returned for review; nothing is saved). */
export const POST = route(async (req, ctx: RouteContext<"/api/decks/[id]/generate-sentences">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const key = userGeminiKey(user);
  if (!key) throw new ApiError(404, "no_gemini_key", "Add your Gemini API key in Settings to use this feature");
  const { count } = await parseJson(req, generateSentencesSchema);
  const cards = await getDeckCards(deck.id);
  if (cards.length === 0) throw new ApiError(400, "no_words", "Add some words to the deck first");
  await geminiRateLimit(user.id);
  let raw: unknown;
  try {
    raw = await geminiGenerateSentences(key, cards, deck.termLang, deck.definitionLang, count);
  } catch (err) {
    console.warn("Gemini sentences failed:", err instanceof Error ? err.message : err);
    throw new ApiError(502, "generate_failed", "Couldn't generate sentences right now. Please try again.");
  }
  const list = Array.isArray(raw) ? raw : (raw as { sentences?: unknown })?.sentences;
  const parsed = generatedSentencesSchema.safeParse(Array.isArray(list) ? list.slice(0, count) : list);
  if (!parsed.success) throw new ApiError(502, "generate_failed", "The generated sentences were invalid. Please try again.");
  return ok({ sentences: parsed.data });
});
