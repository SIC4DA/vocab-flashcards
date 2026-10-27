import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDeckCards, getDeckSentences, getOwnedDeck, upsertSentences } from "@/lib/data";
import { sentencesPutSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Full upsert of the deck's sentences (create / update / delete / reorder) in one transaction. */
export const PUT = route(async (req, ctx: RouteContext<"/api/decks/[id]/sentences">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const { sentences } = await parseJson(req, sentencesPutSchema);
  await upsertSentences(deck.id, sentences);
  const cards = await getDeckCards(deck.id);
  return ok({ sentences: await getDeckSentences(deck.id, new Map(cards.map((c) => [c.id, c.progress.stage]))) });
});
