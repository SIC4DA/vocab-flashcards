import { and, count, eq, inArray } from "drizzle-orm";
import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { getOwnedDeck } from "@/lib/data";
import { geminiNounGrammar } from "@/lib/gemini";
import { splitArticle } from "@/lib/grammar";
import { cleanGrammar, lookupGermanNoun } from "@/lib/grammar-lookup";
import { genderArticles } from "@/lib/languages";
import { geminiRateLimit } from "@/lib/rate-limit";
import { userGeminiKey } from "@/lib/user-gemini";
import { cardIdsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 25;

const BATCH = 40;

/**
 * Fills in the article and plural of up to 40 not-yet-checked cards: the article written in front of the term,
 * then German Wiktionary (German decks), then the user's Gemini key for whatever is still missing.
 * Never overwrites values the user typed. Returns the cards it checked and how many are still waiting.
 */
export const POST = route(async (req, ctx: RouteContext<"/api/decks/[id]/grammar">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const { cardIds } = await parseJson(req, cardIdsSchema);
  const articles = genderArticles(deck.termLang);
  if (articles.length === 0) return ok({ cards: [], remaining: 0 });

  const db = await getDb();
  const where = and(
    eq(schema.cards.deckId, deck.id),
    eq(schema.cards.grammarChecked, false),
    cardIds?.length ? inArray(schema.cards.id, cardIds) : undefined,
  );
  const todo = await db
    .select({
      id: schema.cards.id,
      term: schema.cards.term,
      definition: schema.cards.definition,
      article: schema.cards.article,
      plural: schema.cards.plural,
    })
    .from(schema.cards)
    .where(where)
    .orderBy(schema.cards.position)
    .limit(BATCH);

  const found = new Map(todo.map((c) => [c.id, { article: c.article ?? splitArticle(c.term, deck.termLang).article, plural: c.plural }]));
  // Only single nouns (optionally with an article) can have an article and plural.
  const isNounLike = (term: string) => splitArticle(term, deck.termLang).noun.split(" ").length === 1;
  const missing = () => todo.filter((c) => isNounLike(c.term) && (!found.get(c.id)!.article || !found.get(c.id)!.plural));

  if (deck.termLang.startsWith("de")) {
    const queue = missing();
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          const g = await lookupGermanNoun(c.term);
          if (!g) continue;
          const cur = found.get(c.id)!;
          found.set(c.id, { article: cur.article ?? g.article, plural: cur.plural ?? g.plural });
        }
      }),
    );
  }

  const key = userGeminiKey(user);
  const rest = missing();
  let aiFailed = false;
  if (key && rest.length) {
    try {
      await geminiRateLimit(user.id);
      const raw = await geminiNounGrammar(key, rest, deck.termLang, articles);
      const list = Array.isArray(raw) ? raw : [];
      for (const item of list as { i?: unknown; article?: unknown; plural?: unknown }[]) {
        const c = typeof item?.i === "number" ? rest[item.i] : undefined;
        if (!c) continue;
        const g = cleanGrammar(item, deck.termLang);
        const cur = found.get(c.id)!;
        found.set(c.id, { article: cur.article ?? g.article, plural: cur.plural ?? g.plural });
      }
    } catch (err) {
      aiFailed = true;
      console.warn("Gemini grammar failed:", err instanceof Error ? err.message : err);
    }
  }

  const out: { id: string; article: string | null; plural: string | null }[] = [];
  for (const c of todo) {
    // When Gemini failed, leave the words it should have checked for a later retry.
    if (aiFailed && rest.includes(c)) continue;
    const g = found.get(c.id)!;
    const plural = g.plural || null;
    await db
      .update(schema.cards)
      .set({ article: g.article, plural, grammarChecked: true })
      .where(eq(schema.cards.id, c.id));
    out.push({ id: c.id, article: g.article, plural });
  }
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.cards)
    .where(and(eq(schema.cards.deckId, deck.id), eq(schema.cards.grammarChecked, false)));
  // After a Gemini failure the caller stops (the rest is retried next time).
  return ok({ cards: out, remaining: aiFailed ? 0 : Number(n) });
});
