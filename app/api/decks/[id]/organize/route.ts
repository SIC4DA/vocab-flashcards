import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { ApiError, ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { getOwnedDeck } from "@/lib/data";
import { geminiOrganize } from "@/lib/gemini";
import { geminiRateLimit } from "@/lib/rate-limit";
import { userGeminiKey } from "@/lib/user-gemini";
import { organizedCardsSchema, organizeSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 25;

/** Image sources the AI may change. Pictures the user chose, pasted or uploaded — or removed — are left alone. */
const AUTO_SOURCES = new Set<string | null>([null, "auto"]);

/**
 * AI pass over up to 80 cards (the user's own Gemini key): decides which words need a picture,
 * suggests an image keyword and a topic group. Removes automatic pictures from words that don't need one.
 */
export const POST = route(async (req, ctx: RouteContext<"/api/decks/[id]/organize">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const key = userGeminiKey(user);
  if (!key) throw new ApiError(404, "no_gemini_key", "Add your Gemini API key in Settings to use this feature");
  const { cardIds, force } = await parseJson(req, organizeSchema);
  const db = await getDb();

  const where = cardIds?.length
    ? and(eq(schema.cards.deckId, deck.id), inArray(schema.cards.id, cardIds))
    : and(eq(schema.cards.deckId, deck.id), sql`${schema.cards.groupLabel} is null`);
  const cards = await db
    .select({
      id: schema.cards.id,
      term: schema.cards.term,
      definition: schema.cards.definition,
      imageUrl: schema.cards.imageUrl,
      imageSource: schema.cards.imageSource,
      hasUpload: sql<boolean>`${schema.cards.imageData} is not null`,
      groupLabel: schema.cards.groupLabel,
    })
    .from(schema.cards)
    .where(where)
    .orderBy(schema.cards.position)
    .limit(80);
  const todo = force ? cards : cards.filter((c) => !c.groupLabel);
  if (todo.length === 0) return ok({ cards: [] });

  const groupsRows = await db
    .selectDistinct({ g: schema.cards.groupLabel })
    .from(schema.cards)
    .where(and(eq(schema.cards.deckId, deck.id), isNotNull(schema.cards.groupLabel)));
  await geminiRateLimit(user.id);
  let raw: unknown;
  try {
    raw = await geminiOrganize(key, todo, deck.termLang, groupsRows.map((r) => r.g!).filter(Boolean));
  } catch (err) {
    console.warn("Gemini organize failed:", err instanceof Error ? err.message : err);
    throw new ApiError(502, "organize_failed", "Gemini couldn't organise these words right now. Please try again later.");
  }
  const list = Array.isArray(raw) ? raw : (raw as { cards?: unknown })?.cards;
  const parsed = organizedCardsSchema.safeParse(list);
  if (!parsed.success) throw new ApiError(502, "organize_failed", "Gemini returned an unexpected answer. Please try again.");

  const out: { id: string; group: string; noImage: boolean; imageRemoved: boolean }[] = [];
  for (const item of parsed.data) {
    const c = todo[item.i];
    if (!c) continue;
    const update: Partial<typeof schema.cards.$inferInsert> = {
      groupLabel: item.group,
      imageQuery: item.image && item.keyword.trim() ? item.keyword.trim() : null,
    };
    let imageRemoved = false;
    let noImage = false;
    if (AUTO_SOURCES.has(c.imageSource) && !c.hasUpload) {
      noImage = !item.image;
      update.noImage = noImage;
      if (noImage && c.imageUrl) {
        update.imageUrl = null;
        update.imageAttribution = null;
        imageRemoved = true;
      }
    }
    await db.update(schema.cards).set(update).where(eq(schema.cards.id, c.id));
    out.push({ id: c.id, group: item.group, noImage, imageRemoved });
  }
  return ok({ cards: out });
});
