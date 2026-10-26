import { eq } from "drizzle-orm";
import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { getDeckDetail, getOwnedDeck, toDeckDTO } from "@/lib/data";
import { deckPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

type Ctx = RouteContext<"/api/decks/[id]">;

export const GET = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  return ok(await getDeckDetail(user.id, id));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const patch = await parseJson(req, deckPatchSchema);
  const db = await getDb();
  const [updated] = await db.update(schema.decks).set(patch).where(eq(schema.decks.id, deck.id)).returning();
  return ok({ deck: toDeckDTO(updated) });
});

export const DELETE = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const db = await getDb();
  await db.delete(schema.decks).where(eq(schema.decks.id, deck.id));
  return ok({ ok: true });
});
