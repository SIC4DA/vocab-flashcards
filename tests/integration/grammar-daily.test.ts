import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as deckCards from "@/app/api/decks/[id]/cards/route";
import * as grammar from "@/app/api/decks/[id]/grammar/route";
import * as importRoute from "@/app/api/decks/[id]/import/route";
import * as geminiKey from "@/app/api/account/gemini-key/route";
import * as review from "@/app/api/review/route";
import * as queue from "@/app/api/study/queue/route";
import * as due from "@/app/api/study/due/route";
import { getDb, schema } from "@/lib/db/client";
import { call } from "../support/route";
import { createDeck, registerUser } from "../support/fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  globalThis.fetch = fn as typeof fetch;
  return fn;
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

async function setProgress(cardId: string, stage: number, dueAt: Date) {
  const db = await getDb();
  await db.insert(schema.cardProgress).values({ cardId, stage, dueAt, intervalDays: 10, reps: 3 });
}

async function card(cardId: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.cards).where(eq(schema.cards.id, cardId));
  return c;
}

describe("daily review", () => {
  it("picks known words, continues after a reload, completes and counts the streak", async () => {
    const a = await registerUser("daily_user");
    const { cards } = await createDeck(a.cookie, [
      { term: "el perro", definition: "dog" },
      { term: "el gato", definition: "cat" },
      { term: "la casa", definition: "house" },
      { term: "el libro", definition: "book" },
    ]);
    await setProgress(cards[0].id, 6, inDays(5));
    await setProgress(cards[1].id, 6, inDays(5));
    await setProgress(cards[2].id, 4, inDays(-1)); // due
    await setProgress(cards[3].id, 2, inDays(-1)); // still learning: not in the daily review

    const before = await call(due.GET, { cookie: a.cookie, url: "/api/study/due?tz=0" });
    expect(before.json.streak).toBe(0);
    expect(before.json.week).toHaveLength(7);
    expect(before.json.daily).toMatchObject({ total: 3, answered: 0, completed: false, known: 3 });

    const q1 = await call(queue.GET, { cookie: a.cookie, url: "/api/study/queue?mode=daily&tz=0" });
    expect(q1.status).toBe(200);
    expect(q1.json.questions).toHaveLength(3);
    expect(q1.json.cards.map((c: { id: string }) => c.id).sort()).toEqual([cards[0].id, cards[1].id, cards[2].id].sort());

    // A right answer to a word that isn't due doesn't move its review date.
    const first = await call(review.POST, {
      cookie: a.cookie,
      body: { cardId: cards[0].id, mode: "daily", questionType: "write", correct: true, grade: 4, tz: 0 },
    });
    expect(first.json.daily).toMatchObject({ total: 3, answered: 1, completed: false });
    expect(new Date(first.json.progress.dueAt).getTime()).toBeGreaterThan(inDays(4).getTime());

    // Reload: the same list, minus what's answered.
    const q2 = await call(queue.GET, { cookie: a.cookie, url: "/api/study/queue?mode=daily&tz=0" });
    expect(q2.json.questions.map((q: { cardId: string }) => q.cardId).sort()).toEqual([cards[1].id, cards[2].id].sort());

    // A wrong answer sends a mastered word back to Written.
    const wrong = await call(review.POST, {
      cookie: a.cookie,
      body: { cardId: cards[1].id, mode: "daily", questionType: "write", correct: false, grade: 1, tz: 0 },
    });
    expect(wrong.json.progress.stage).toBe(4);
    const last = await call(review.POST, {
      cookie: a.cookie,
      body: { cardId: cards[2].id, mode: "daily", questionType: "dictation", correct: true, grade: 4, tz: 0 },
    });
    expect(last.json.daily).toMatchObject({ answered: 3, completed: true });

    const after = await call(due.GET, { cookie: a.cookie, url: "/api/study/due?tz=0" });
    expect(after.json.streak).toBe(1);
    expect(after.json.week.at(-1)).toEqual({ day: today(), done: true });
    expect(after.json.daily.completed).toBe(true);

    const again = await call(queue.GET, { cookie: a.cookie, url: "/api/study/queue?mode=daily&tz=0" });
    expect(again.json.questions).toHaveLength(0);
    expect(again.json.daily.completed).toBe(true);
    // "Keep reviewing": every known word was already reviewed today.
    const extra = await call(queue.GET, { cookie: a.cookie, url: "/api/study/queue?mode=daily&tz=0&bonus=1" });
    expect(extra.json.questions).toHaveLength(0);

    // Yesterday finished too → 2 days.
    const db = await getDb();
    const yesterday = inDays(-1).toISOString().slice(0, 10);
    await db.insert(schema.dailyReviews).values({ userId: a.user.id, day: yesterday, cardIds: [], completedAt: inDays(-1) });
    expect((await call(due.GET, { cookie: a.cookie, url: "/api/study/due?tz=0" })).json.streak).toBe(2);
  });

  it("a Learn answer doesn't count towards the streak, and there's nothing to review without known words", async () => {
    const a = await registerUser("daily_none");
    const { cards } = await createDeck(a.cookie, [{ term: "el perro", definition: "dog" }]);
    await call(review.POST, { cookie: a.cookie, body: { cardId: cards[0].id, mode: "learn", questionType: "flashcard", correct: true } });
    const q = await call(queue.GET, { cookie: a.cookie, url: "/api/study/queue?mode=daily&tz=0" });
    expect(q.json.questions).toHaveLength(0);
    expect(q.json.daily).toMatchObject({ total: 0, known: 0, completed: false });
    expect((await call(due.GET, { cookie: a.cookie, url: "/api/study/due?tz=0" })).json.streak).toBe(0);
    const db = await getDb();
    expect(await db.select().from(schema.dailyReviews).where(eq(schema.dailyReviews.userId, a.user.id))).toHaveLength(0);
  });

  it("deleted words don't block today's review", async () => {
    const a = await registerUser("daily_delete");
    const { deckId, cards } = await createDeck(a.cookie, [
      { term: "el perro", definition: "dog" },
      { term: "el gato", definition: "cat" },
    ]);
    await setProgress(cards[0].id, 6, inDays(-1));
    await setProgress(cards[1].id, 6, inDays(-1));
    await call(queue.GET, { cookie: a.cookie, url: "/api/study/queue?mode=daily&tz=0" });
    // Delete the second word, then answer the first.
    await call(deckCards.PUT, { method: "PUT", cookie: a.cookie, params: { id: deckId }, body: { cards: [{ id: cards[0].id, term: "el perro", definition: "dog" }] } });
    const r = await call(review.POST, { cookie: a.cookie, body: { cardId: cards[0].id, mode: "daily", questionType: "write", correct: true, tz: 0 } });
    expect(r.json.daily.completed).toBe(true);
  });
});

const WIKI: Record<string, string> = {
  Buch: "== Buch ({{Sprache|Deutsch}}) ==\n{{Deutsch Substantiv Übersicht\n|Genus=n\n|Nominativ Singular=Buch\n|Nominativ Plural=Bücher\n}}",
  Hund: "{{Deutsch Substantiv Übersicht\n|Genus=m\n|Nominativ Singular=Hund\n|Nominativ Plural=Hunde\n}}",
  Haus: "{{Deutsch Substantiv Übersicht\n|Genus=n\n|Nominativ Plural=Häuserx\n}}",
  Obst: "{{Deutsch Substantiv Übersicht\n|Genus=n\n|Nominativ Plural=—\n}}",
};

describe("articles & plurals", () => {
  it("fills in German articles and plurals from Wiktionary without overwriting the user's", async () => {
    const a = await registerUser("grammar_de");
    const { deckId, cards } = await createDeck(
      a.cookie,
      [
        { term: "das Buch", definition: "book" },
        { term: "Hund", definition: "dog" },
        { term: "gehen", definition: "to go" },
        { term: "Haus", definition: "house", article: "das", plural: "Häuser" },
        { term: "Obst", definition: "fruit" },
        { term: "guten Morgen", definition: "good morning" },
      ],
      "de-DE",
    );
    const fetchMock = mockFetch((url) => {
      const u = new URL(url);
      expect(u.hostname).toBe("de.wiktionary.org");
      expect(u.searchParams.get("action")).toBe("parse");
      const text = WIKI[u.searchParams.get("page") ?? ""];
      return text ? json({ parse: { wikitext: text } }) : json({ error: { code: "missingtitle" } });
    });
    const r = await call(grammar.POST, { cookie: a.cookie, params: { id: deckId }, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.remaining).toBe(0);
    // "guten Morgen" is a phrase: not looked up. "Haus" already has both.
    const asked = fetchMock.mock.calls.map(([u]) => new URL(String(u)).searchParams.get("page")).sort();
    expect(asked).toEqual(["Buch", "Gehen", "Hund", "Obst"]);

    expect(await card(cards[0].id)).toMatchObject({ article: "das", plural: "Bücher", grammarChecked: true });
    expect(await card(cards[1].id)).toMatchObject({ article: "der", plural: "Hunde" });
    expect(await card(cards[2].id)).toMatchObject({ article: null, plural: null, grammarChecked: true });
    expect(await card(cards[3].id)).toMatchObject({ article: "das", plural: "Häuser" });
    expect(await card(cards[4].id)).toMatchObject({ article: "das", plural: "—" });

    // Nothing left to check.
    const again = await call(grammar.POST, { cookie: a.cookie, params: { id: deckId }, body: {} });
    expect(again.json).toEqual({ cards: [], remaining: 0 });

    // A different word: the old article/plural go and it's checked again; a typed plural is kept.
    const saved = await call(deckCards.PUT, {
      method: "PUT",
      cookie: a.cookie,
      params: { id: deckId },
      body: {
        cards: [
          { id: cards[1].id, term: "Katze", definition: "cat", article: "der", plural: "Hunde" },
          { id: cards[0].id, term: "Heft", definition: "notebook", article: null, plural: "Hefte" },
        ],
      },
    });
    expect(saved.status).toBe(200);
    expect(await card(cards[1].id)).toMatchObject({ article: null, plural: null, grammarChecked: false });
    expect(await card(cards[0].id)).toMatchObject({ plural: "Hefte", grammarChecked: false });
  });

  it("uses the Gemini key for other languages, and the article in front of the term without one", async () => {
    const a = await registerUser("grammar_es");
    const { deckId, cards } = await createDeck(a.cookie, [
      { term: "el perro", definition: "dog" },
      { term: "lápiz", definition: "pencil" },
    ]);
    const noKey = mockFetch(() => json({}));
    await call(grammar.POST, { cookie: a.cookie, params: { id: deckId }, body: { cardIds: [cards[0].id] } });
    expect(noKey).not.toHaveBeenCalled();
    expect(await card(cards[0].id)).toMatchObject({ article: "el", plural: null, grammarChecked: true });

    mockFetch(() => json({ totalTokens: 2 }));
    await call(geminiKey.PUT, { method: "PUT", cookie: a.cookie, body: { apiKey: "AQ.Ab8RN6Integration-Key_123.xyz7890" } });
    mockFetch((url, init) => {
      expect(url).toContain(":generateContent");
      const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
      expect(prompt).toContain('["el","la"]');
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ i: 0, article: "el", plural: "lápices" }]) }] } }] });
    });
    const r = await call(grammar.POST, { cookie: a.cookie, params: { id: deckId }, body: {} });
    expect(r.json.cards).toEqual([{ id: cards[1].id, article: "el", plural: "lápices" }]);
  });

  it("splits plurals on import and records game answers as stats only", async () => {
    const a = await registerUser("grammar_game");
    const { deckId, cards } = await createDeck(a.cookie, [{ term: "der Hund", definition: "dog" }], "de-DE");
    await call(importRoute.POST, {
      cookie: a.cookie,
      params: { id: deckId },
      body: { text: "das Auto, die Autos - car\ngut, danke - fine, thanks", commit: true },
    });
    const db = await getDb();
    const imported = await db.select().from(schema.cards).where(and(eq(schema.cards.deckId, deckId), eq(schema.cards.term, "das Auto")));
    expect(imported[0].plural).toBe("Autos");
    // Not "article + noun, plural": the term is left as it is.
    const [phrase] = await db.select().from(schema.cards).where(and(eq(schema.cards.deckId, deckId), eq(schema.cards.term, "gut, danke")));
    expect(phrase).toMatchObject({ definition: "fine, thanks", plural: null });

    // A word never studied in Learn: its stats are kept (both answers), but it stays New
    // and doesn't use up Learn's new words for today.
    await call(review.POST, { cookie: a.cookie, body: { cardId: cards[0].id, mode: "grammar", questionType: "article", correct: true } });
    const r = await call(review.POST, { cookie: a.cookie, body: { cardId: cards[0].id, mode: "grammar", questionType: "plural", correct: true } });
    expect(r.json.progress).toMatchObject({ stage: 0, modeStats: { article: { correct: 1, wrong: 0 }, plural: { correct: 1, wrong: 0 } } });
    const learn = await call(queue.GET, { cookie: a.cookie, url: `/api/study/queue?mode=learn&deckId=${deckId}&tz=0` });
    expect(learn.json.newAllowed).toBe(10);
    expect(learn.json.questions.map((x: { cardId: string }) => x.cardId)).toContain(cards[0].id);
    // Seeing it in Learn introduces it today.
    await call(review.POST, { cookie: a.cookie, body: { cardId: cards[0].id, mode: "learn", questionType: "flashcard", correct: true, tz: 0 } });
    const learn2 = await call(queue.GET, { cookie: a.cookie, url: `/api/study/queue?mode=learn&deckId=${deckId}&tz=0` });
    expect(learn2.json.newAllowed).toBe(9);
    await db.delete(schema.cardProgress).where(eq(schema.cardProgress.cardId, cards[0].id));

    // A word in progress: counts in its stats, the ladder and schedule stay as they are.
    await setProgress(cards[0].id, 3, inDays(2));
    const p = await call(review.POST, { cookie: a.cookie, body: { cardId: cards[0].id, mode: "grammar", questionType: "plural", correct: false } });
    expect(p.json.progress).toMatchObject({ stage: 3, modeStats: { plural: { correct: 0, wrong: 1 } } });
    expect(new Date(p.json.progress.dueAt).getTime()).toBeGreaterThan(inDays(1).getTime());

    // The game gets the deck's cards with their grammar.
    const q = await call(queue.GET, { cookie: a.cookie, url: `/api/study/queue?mode=grammar&deckId=${deckId}` });
    expect(q.json.cards.find((c: { term: string }) => c.term === "das Auto").plural).toBe("Autos");
  });
});
