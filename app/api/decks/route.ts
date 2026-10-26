import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { assertDeckQuota, listDecks, toDeckDTO } from "@/lib/data";
import { deckInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return ok({ decks: await listDecks(user.id) });
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await parseJson(req, deckInputSchema);
  await assertDeckQuota(user.id);
  const db = await getDb();
  const [deck] = await db
    .insert(schema.decks)
    .values({ userId: user.id, ...input })
    .returning();
  return ok({ deck: toDeckDTO(deck) }, { status: 201 });
});
