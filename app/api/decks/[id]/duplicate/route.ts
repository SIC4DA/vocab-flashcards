import { ok, requireUser, route } from "@/lib/api";
import { duplicateDeck, toDeckDTO } from "@/lib/data";

export const runtime = "nodejs";

export const POST = route(async (req, ctx: RouteContext<"/api/decks/[id]/duplicate">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const copy = await duplicateDeck(user.id, id);
  return ok({ deck: toDeckDTO(copy) }, { status: 201 });
});
