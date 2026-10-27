import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "./db/client";
import { ApiError, notFound, UUID_RE } from "./api";
import { NEW_PROGRESS, MAX_STAGE, type Progress, type StudyCard } from "./learn";
import { LIMITS, type Settings } from "./validation";
import type { Card, CardProgress, Deck } from "./db/schema";
import type { z } from "zod";
import type { cardInputSchema } from "./validation";

export type DeckSummary = {
  id: string;
  title: string;
  description: string;
  termLang: string;
  definitionLang: string;
  cardCount: number;
  dueCount: number;
  masteredCount: number;
  lastStudiedAt: string | null;
  updatedAt: string;
};

export type CardDTO = {
  id: string;
  position: number;
  term: string;
  definition: string;
  example: string;
  imageUrl: string | null;
  /** URL to display (external URL or the uploaded-image endpoint). */
  displayImageUrl: string | null;
  hasUploadedImage: boolean;
  imageAttribution: string | null;
  imageSource: string | null;
  /** This word doesn't need a picture (AI/heuristic decision, or the user removed it). */
  noImage: boolean;
  /** Topic group suggested by AI. */
  groupLabel: string | null;
  progress: Progress;
};

export type DeckDTO = {
  id: string;
  title: string;
  description: string;
  termLang: string;
  definitionLang: string;
  matchBestMs: number | null;
  lastStudiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function toProgress(p: CardProgress | null | undefined): Progress {
  if (!p) return { ...NEW_PROGRESS };
  return {
    stage: p.stage,
    correctStreak: p.correctStreak,
    ease: p.ease,
    intervalDays: p.intervalDays,
    reps: p.reps,
    lapses: p.lapses,
    dueAt: iso(p.dueAt),
    lastReviewedAt: iso(p.lastReviewedAt),
    modeStats: p.modeStats ?? {},
  };
}

type CardRow = Omit<Card, "imageData"> & { hasImageData: boolean };

const cardColumns = {
  id: schema.cards.id,
  deckId: schema.cards.deckId,
  position: schema.cards.position,
  term: schema.cards.term,
  definition: schema.cards.definition,
  example: schema.cards.example,
  imageUrl: schema.cards.imageUrl,
  imageMime: schema.cards.imageMime,
  imageAttribution: schema.cards.imageAttribution,
  imageSource: schema.cards.imageSource,
  noImage: schema.cards.noImage,
  imageQuery: schema.cards.imageQuery,
  groupLabel: schema.cards.groupLabel,
  createdAt: schema.cards.createdAt,
  updatedAt: schema.cards.updatedAt,
  hasImageData: sql<boolean>`${schema.cards.imageData} is not null`,
};

export function displayImageUrl(c: Pick<CardRow, "id" | "imageUrl" | "hasImageData" | "updatedAt">) {
  if (c.hasImageData) return `/api/cards/${c.id}/image?v=${new Date(c.updatedAt).getTime()}`;
  return c.imageUrl ?? null;
}

export function toCardDTO(c: CardRow, p: CardProgress | null | undefined): CardDTO {
  return {
    id: c.id,
    position: c.position,
    term: c.term,
    definition: c.definition,
    example: c.example,
    imageUrl: c.imageUrl,
    displayImageUrl: displayImageUrl(c),
    hasUploadedImage: c.hasImageData,
    imageAttribution: c.imageAttribution,
    imageSource: c.imageSource,
    noImage: c.noImage,
    groupLabel: c.groupLabel,
    progress: toProgress(p),
  };
}

export function toDeckDTO(d: Deck): DeckDTO {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    termLang: d.termLang,
    definitionLang: d.definitionLang,
    matchBestMs: d.matchBestMs,
    lastStudiedAt: iso(d.lastStudiedAt),
    createdAt: iso(d.createdAt)!,
    updatedAt: iso(d.updatedAt)!,
  };
}

export function toStudyCard(deck: Pick<Deck, "id" | "termLang" | "definitionLang">, c: CardDTO): StudyCard {
  return {
    id: c.id,
    deckId: deck.id,
    term: c.term,
    definition: c.definition,
    example: c.example,
    imageUrl: c.displayImageUrl,
    imageAttribution: c.imageAttribution,
    group: c.groupLabel,
    termLang: deck.termLang,
    definitionLang: deck.definitionLang,
    progress: c.progress,
  };
}

/* ------------------------------ ownership ------------------------------ */

/** Returns the deck if the user owns it; otherwise 404 (never 403). */
export async function getOwnedDeck(userId: string, deckId: string, db?: DB): Promise<Deck> {
  if (!UUID_RE.test(deckId)) throw notFound("Deck not found");
  db ??= await getDb();
  const [deck] = await db
    .select()
    .from(schema.decks)
    .where(and(eq(schema.decks.id, deckId), eq(schema.decks.userId, userId)))
    .limit(1);
  if (!deck) throw notFound("Deck not found");
  return deck;
}

export async function getOwnedCard(userId: string, cardId: string) {
  if (!UUID_RE.test(cardId)) throw notFound("Card not found");
  const db = await getDb();
  const [row] = await db
    .select({ card: schema.cards, deck: schema.decks })
    .from(schema.cards)
    .innerJoin(schema.decks, eq(schema.cards.deckId, schema.decks.id))
    .where(and(eq(schema.cards.id, cardId), eq(schema.decks.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Card not found");
  return row;
}

/* -------------------------------- decks -------------------------------- */

export async function listDecks(userId: string, now = new Date()): Promise<DeckSummary[]> {
  const db = await getDb();
  const decks = await db
    .select()
    .from(schema.decks)
    .where(eq(schema.decks.userId, userId))
    .orderBy(desc(schema.decks.updatedAt));
  if (decks.length === 0) return [];
  const ids = decks.map((d) => d.id);
  const stats = await db
    .select({
      deckId: schema.cards.deckId,
      cardCount: count(schema.cards.id),
      dueCount: sql<number>`count(*) filter (where ${schema.cardProgress.stage} >= 1 and ${schema.cardProgress.dueAt} <= ${now.toISOString()})`,
      masteredCount: sql<number>`count(*) filter (where ${schema.cardProgress.stage} >= ${MAX_STAGE})`,
    })
    .from(schema.cards)
    .leftJoin(schema.cardProgress, eq(schema.cardProgress.cardId, schema.cards.id))
    .where(inArray(schema.cards.deckId, ids))
    .groupBy(schema.cards.deckId);
  const byDeck = new Map(stats.map((s) => [s.deckId, s]));
  return decks.map((d) => {
    const s = byDeck.get(d.id);
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      termLang: d.termLang,
      definitionLang: d.definitionLang,
      cardCount: Number(s?.cardCount ?? 0),
      dueCount: Number(s?.dueCount ?? 0),
      masteredCount: Number(s?.masteredCount ?? 0),
      lastStudiedAt: iso(d.lastStudiedAt),
      updatedAt: iso(d.updatedAt)!,
    };
  });
}

export async function countDecks(userId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(schema.decks).where(eq(schema.decks.userId, userId));
  return Number(row?.n ?? 0);
}

export async function assertDeckQuota(userId: string) {
  if ((await countDecks(userId)) >= LIMITS.decksPerUser) {
    throw new ApiError(400, "limit_reached", `You can have at most ${LIMITS.decksPerUser} decks`);
  }
}

export async function getDeckCards(deckId: string, db?: DB): Promise<CardDTO[]> {
  db ??= await getDb();
  const rows = await db
    .select({ card: cardColumns, progress: schema.cardProgress })
    .from(schema.cards)
    .leftJoin(schema.cardProgress, eq(schema.cardProgress.cardId, schema.cards.id))
    .where(eq(schema.cards.deckId, deckId))
    .orderBy(asc(schema.cards.position));
  return rows.map((r) => toCardDTO(r.card as CardRow, r.progress));
}

export async function getDeckDetail(userId: string, deckId: string) {
  const deck = await getOwnedDeck(userId, deckId);
  const cards = await getDeckCards(deck.id);
  return { deck: toDeckDTO(deck), cards };
}

/* --------------------------------- cards -------------------------------- */

type CardInput = z.infer<typeof cardInputSchema>;

/**
 * Replace the deck's card list in one transaction: creates new rows, updates existing ones
 * (matched by id within this deck), deletes missing ones, and rewrites positions.
 */
export async function upsertCards(deckId: string, inputs: CardInput[]): Promise<void> {
  if (inputs.length > LIMITS.cardsPerDeck) {
    throw new ApiError(400, "limit_reached", `A deck can have at most ${LIMITS.cardsPerDeck} cards`);
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.cards.id, term: schema.cards.term, definition: schema.cards.definition })
      .from(schema.cards)
      .where(eq(schema.cards.deckId, deckId));
    const byId = new Map(existing.map((e) => [e.id, e]));
    const existingIds = new Set(byId.keys());
    const keep = new Set<string>();

    for (let i = 0; i < inputs.length; i++) {
      const c = inputs[i];
      const base: Partial<typeof schema.cards.$inferInsert> = {
        position: i,
        term: c.term,
        definition: c.definition,
        example: c.example ?? "",
        imageUrl: c.imageUrl ?? null,
        imageAttribution: c.imageAttribution ?? null,
      };
      if (c.imageSource !== undefined) base.imageSource = c.imageSource;
      if (c.noImage !== undefined) base.noImage = c.noImage;
      if (c.id && existingIds.has(c.id)) {
        keep.add(c.id);
        const update: Partial<typeof schema.cards.$inferInsert> = { ...base };
        if (c.keepUploadedImage === false || c.imageUrl) {
          update.imageData = null;
          update.imageMime = null;
        }
        const before = byId.get(c.id)!;
        if (before.term !== c.term || before.definition !== c.definition) {
          // The word changed: AI suggestions (topic, image keyword) must be recomputed.
          update.groupLabel = null;
          update.imageQuery = null;
        }
        await tx.update(schema.cards).set(update).where(eq(schema.cards.id, c.id));
      } else {
        await tx.insert(schema.cards).values({ deckId, ...base } as typeof schema.cards.$inferInsert);
      }
    }
    const toDelete = [...existingIds].filter((id) => !keep.has(id));
    if (toDelete.length) await tx.delete(schema.cards).where(inArray(schema.cards.id, toDelete));
    await tx.update(schema.decks).set({ updatedAt: new Date() }).where(eq(schema.decks.id, deckId));
  });
}

export async function appendCards(deckId: string, rows: { term: string; definition: string }[]) {
  const db = await getDb();
  const [{ n, maxPos }] = await db
    .select({ n: count(), maxPos: sql<number>`coalesce(max(${schema.cards.position}), -1)` })
    .from(schema.cards)
    .where(eq(schema.cards.deckId, deckId));
  if (Number(n) + rows.length > LIMITS.cardsPerDeck) {
    throw new ApiError(400, "limit_reached", `A deck can have at most ${LIMITS.cardsPerDeck} cards`);
  }
  if (rows.length === 0) return;
  const start = Number(maxPos) + 1;
  await db
    .insert(schema.cards)
    .values(rows.map((r, i) => ({ deckId, position: start + i, term: r.term, definition: r.definition })));
  await db.update(schema.decks).set({ updatedAt: new Date() }).where(eq(schema.decks.id, deckId));
}

export async function duplicateDeck(userId: string, deckId: string): Promise<Deck> {
  const deck = await getOwnedDeck(userId, deckId);
  await assertDeckQuota(userId);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(schema.decks)
      .values({
        userId,
        title: `${deck.title} (copy)`.slice(0, 100),
        description: deck.description,
        termLang: deck.termLang,
        definitionLang: deck.definitionLang,
      })
      .returning();
    const cards = await tx.select().from(schema.cards).where(eq(schema.cards.deckId, deck.id));
    if (cards.length) {
      await tx.insert(schema.cards).values(
        cards.map((c) => ({
          deckId: copy.id,
          position: c.position,
          term: c.term,
          definition: c.definition,
          example: c.example,
          imageUrl: c.imageUrl,
          imageData: c.imageData,
          imageMime: c.imageMime,
          imageAttribution: c.imageAttribution,
          imageSource: c.imageSource,
          noImage: c.noImage,
          imageQuery: c.imageQuery,
          groupLabel: c.groupLabel,
        })),
      );
    }
    return copy;
  });
}

export async function resetDeckProgress(deckId: string) {
  const db = await getDb();
  const ids = db.select({ id: schema.cards.id }).from(schema.cards).where(eq(schema.cards.deckId, deckId));
  await db.delete(schema.cardProgress).where(inArray(schema.cardProgress.cardId, ids));
}

export async function resetCardProgress(cardId: string) {
  const db = await getDb();
  await db.delete(schema.cardProgress).where(eq(schema.cardProgress.cardId, cardId));
}

/* -------------------------------- progress ------------------------------- */

export async function saveProgress(cardId: string, p: Progress, db?: DB) {
  db ??= await getDb();
  const values = {
    cardId,
    stage: p.stage,
    ease: p.ease,
    intervalDays: p.intervalDays,
    dueAt: p.dueAt ? new Date(p.dueAt) : new Date(),
    reps: p.reps,
    lapses: p.lapses,
    correctStreak: p.correctStreak,
    lastReviewedAt: p.lastReviewedAt ? new Date(p.lastReviewedAt) : null,
    modeStats: p.modeStats,
  };
  const { cardId: _ignored, ...update } = values;
  void _ignored;
  await db
    .insert(schema.cardProgress)
    .values(values)
    .onConflictDoUpdate({ target: schema.cardProgress.cardId, set: { ...update, updatedAt: new Date() } });
}

/** Number of cards the user started learning today (progress rows created since local midnight). */
export async function newCardsIntroducedToday(userId: string, since: Date): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(schema.cardProgress)
    .innerJoin(schema.cards, eq(schema.cards.id, schema.cardProgress.cardId))
    .innerJoin(schema.decks, eq(schema.decks.id, schema.cards.deckId))
    .where(and(eq(schema.decks.userId, userId), gte(schema.cardProgress.createdAt, since)));
  return Number(row?.n ?? 0);
}

export function newAllowedToday(settings: Settings, introducedToday: number) {
  return Math.max(0, settings.newPerDay - introducedToday);
}

/** Due cards across all of the user's decks, grouped. */
export async function dueSummary(userId: string, now = new Date()) {
  const db = await getDb();
  const rows = await db
    .select({ deckId: schema.cards.deckId, n: count() })
    .from(schema.cardProgress)
    .innerJoin(schema.cards, eq(schema.cards.id, schema.cardProgress.cardId))
    .innerJoin(schema.decks, eq(schema.decks.id, schema.cards.deckId))
    .where(
      and(eq(schema.decks.userId, userId), gte(schema.cardProgress.stage, 1), lte(schema.cardProgress.dueAt, now)),
    )
    .groupBy(schema.cards.deckId);
  const perDeck: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    perDeck[r.deckId] = Number(r.n);
    total += Number(r.n);
  }
  return { total, perDeck };
}

/** Distinct local review days (YYYY-MM-DD) for streak computation. */
export async function reviewDays(userId: string, tzOffsetMinutes: number): Promise<string[]> {
  const db = await getDb();
  const since = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  const rows = await db
    .selectDistinct({
      day: sql<string>`to_char(${schema.reviewLog.createdAt} - make_interval(mins => ${tzOffsetMinutes}), 'YYYY-MM-DD')`,
    })
    .from(schema.reviewLog)
    .where(and(eq(schema.reviewLog.userId, userId), gte(schema.reviewLog.createdAt, since)));
  return rows.map((r) => r.day);
}

/** Consecutive days with ≥ 1 review, ending today (or yesterday if nothing yet today). */
export function computeStreak(days: string[], today: string): number {
  const set = new Set(days);
  const d = new Date(`${today}T00:00:00Z`);
  if (!set.has(today)) d.setUTCDate(d.getUTCDate() - 1);
  let streak = 0;
  while (set.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return streak;
}

export function localDay(now: Date, tzOffsetMinutes: number): string {
  return new Date(now.getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function localMidnight(now: Date, tzOffsetMinutes: number): Date {
  const day = localDay(now, tzOffsetMinutes);
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + tzOffsetMinutes * 60_000);
}

/** All cards (with progress) of the given decks, for building review sessions. */
export async function cardsForDecks(deckIds: string[]) {
  if (deckIds.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select({ card: cardColumns, progress: schema.cardProgress })
    .from(schema.cards)
    .leftJoin(schema.cardProgress, eq(schema.cardProgress.cardId, schema.cards.id))
    .where(inArray(schema.cards.deckId, deckIds))
    .orderBy(asc(schema.cards.position));
  return rows.map((r) => ({ deckId: (r.card as CardRow).deckId, dto: toCardDTO(r.card as CardRow, r.progress) }));
}

export async function decksWithDueCards(userId: string, now = new Date()) {
  const db = await getDb();
  const rows = await db
    .selectDistinct({ deck: schema.decks })
    .from(schema.decks)
    .innerJoin(schema.cards, eq(schema.cards.deckId, schema.decks.id))
    .innerJoin(schema.cardProgress, eq(schema.cardProgress.cardId, schema.cards.id))
    .where(
      and(eq(schema.decks.userId, userId), gte(schema.cardProgress.stage, 1), lte(schema.cardProgress.dueAt, now)),
    );
  return rows.map((r) => r.deck);
}

/** Cards that still need the AI "organize" pass (no topic yet). */
export async function cardsNeedingOrganize(deckId: string) {
  const db = await getDb();
  return db
    .select({ id: schema.cards.id })
    .from(schema.cards)
    .where(and(eq(schema.cards.deckId, deckId), sql`${schema.cards.groupLabel} is null`));
}

export async function cardsWithoutImages(deckId: string) {
  const db = await getDb();
  return db
    .select({ id: schema.cards.id })
    .from(schema.cards)
    .where(
      and(
        eq(schema.cards.deckId, deckId),
        sql`${schema.cards.imageUrl} is null`,
        sql`${schema.cards.imageData} is null`,
        eq(schema.cards.noImage, false),
      ),
    );
}

