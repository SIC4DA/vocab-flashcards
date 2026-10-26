import { ok, requireUser, route } from "@/lib/api";
import { getOwnedDeck, resetDeckProgress } from "@/lib/data";

export const runtime = "nodejs";

export const POST = route(async (req, ctx: RouteContext<"/api/decks/[id]/reset-progress">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  await resetDeckProgress(deck.id);
  return ok({ ok: true });
});
