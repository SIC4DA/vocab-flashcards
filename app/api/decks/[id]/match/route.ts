import { eq } from "drizzle-orm";
import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { getOwnedDeck } from "@/lib/data";
import { matchResultSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Record a finished Match game; keeps the best (lowest) time per deck. */
export const POST = route(async (req, ctx: RouteContext<"/api/decks/[id]/match">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const { timeMs } = await parseJson(req, matchResultSchema);
  const isBest = deck.matchBestMs === null || timeMs < deck.matchBestMs;
  const db = await getDb();
  await db
    .update(schema.decks)
    .set({ lastStudiedAt: new Date(), ...(isBest ? { matchBestMs: timeMs } : {}) })
    .where(eq(schema.decks.id, deck.id));
  return ok({ bestMs: isBest ? timeMs : deck.matchBestMs, isBest });
});
