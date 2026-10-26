import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDeckCards, getOwnedDeck, upsertCards } from "@/lib/data";
import { cardsPutSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Full upsert of the card list (create/update/delete/reorder) in one transaction. */
export const PUT = route(async (req, ctx: RouteContext<"/api/decks/[id]/cards">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const { cards } = await parseJson(req, cardsPutSchema);
  await upsertCards(deck.id, cards);
  return ok({ cards: await getDeckCards(deck.id) });
});
