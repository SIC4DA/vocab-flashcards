import { ok, requireUser, route } from "@/lib/api";
import { getOwnedCard, resetCardProgress } from "@/lib/data";

export const runtime = "nodejs";

export const POST = route(async (req, ctx: RouteContext<"/api/cards/[id]/reset-progress">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { card } = await getOwnedCard(user.id, id);
  await resetCardProgress(card.id);
  return ok({ ok: true });
});
