import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as deck from "@/app/api/decks/[id]/route";
import * as deckCards from "@/app/api/decks/[id]/cards/route";
import * as sentencesRoute from "@/app/api/decks/[id]/sentences/route";
import * as genSentences from "@/app/api/decks/[id]/generate-sentences/route";
import * as duplicate from "@/app/api/decks/[id]/duplicate/route";
import * as sentenceReview from "@/app/api/sentence-review/route";
import * as queue from "@/app/api/study/queue/route";
import * as geminiKey from "@/app/api/account/gemini-key/route";
import { getDb, schema } from "@/lib/db/client";
import { call } from "../support/route";
import { createDeck, registerUser } from "../support/fixtures";

const WORDS = [
  { term: "nicht", definition: "not" },
  { term: "sehr", definition: "very" },
  { term: "gut", definition: "good" },
  { term: "kommen", definition: "to come" },
  { term: "woher", definition: "where from" },
];
const SENTENCES = [
  { text: "Mir geht's sehr gut.", translation: "I'm very well." },
  { text: "Woher kommst du?", translation: "Where are you from?", reply: "Ich komme aus Berlin.", replyTranslation: "I'm from Berlin." },
  { text: "Das ist nicht gut.", translation: "That's not good." },
];

async function master(cookie: string, deckId: string, terms: string[]) {
  const db = await getDb();
  const cards = await db.select().from(schema.cards).where(eq(schema.cards.deckId, deckId));
  for (const c of cards.filter((x) => terms.includes(x.term))) {
    await db
      .insert(schema.cardProgress)
      .values({ cardId: c.id, stage: 6, dueAt: new Date(Date.now() + 5 * 86400000) })
      .onConflictDoUpdate({ target: schema.cardProgress.cardId, set: { stage: 6 } });
  }
  void cookie;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("deck sentences", () => {
  it("saves sentences, links deck words, and relinks when words change", async () => {
    const a = await registerUser("sent_owner");
    const { deckId, cards } = await createDeck(a.cookie, WORDS);
    const r = await call(sentencesRoute.PUT, { method: "PUT", cookie: a.cookie, params: { id: deckId }, body: { sentences: SENTENCES } });
    expect(r.status).toBe(200);
    const byText = (list: { text: string; cardIds: string[]; unlocked: boolean }[], t: string) => list.find((x) => x.text === t)!;
    const idOf = (term: string) => cards.find((c) => c.term === term)!.id;
    expect(byText(r.json.sentences, "Mir geht's sehr gut.").cardIds.sort()).toEqual([idOf("sehr"), idOf("gut")].sort());
    expect(byText(r.json.sentences, "Woher kommst du?").cardIds.sort()).toEqual([idOf("woher"), idOf("kommen")].sort());
    expect(r.json.sentences.every((x: { unlocked: boolean }) => !x.unlocked)).toBe(true);

    // Removing the word "nicht" relinks "Das ist nicht gut."
    await call(deckCards.PUT, {
      method: "PUT",
      cookie: a.cookie,
      params: { id: deckId },
      body: { cards: cards.filter((c) => c.term !== "nicht").map((c) => ({ id: c.id, term: c.term, definition: WORDS.find((w) => w.term === c.term)!.definition })) },
    });
    const d = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    expect(byText(d.json.sentences, "Das ist nicht gut.").cardIds).toEqual([idOf("gut")]);
  });

  it("unlocks sentences when their words are mastered and adds them to Learn; examples appear on cards", async () => {
    const a = await registerUser("sent_learner");
    const { deckId } = await createDeck(a.cookie, WORDS);
    await call(sentencesRoute.PUT, { method: "PUT", cookie: a.cookie, params: { id: deckId }, body: { sentences: SENTENCES } });
    let q = await call(queue.GET, { cookie: a.cookie, url: `/api/study/queue?deckId=${deckId}&mode=learn` });
    expect(q.json.session.items.some((i: { kind: string }) => i.kind.startsWith("sentence"))).toBe(false);
    // Examples from sentences show on the word cards
    expect(q.json.cards.find((c: { term: string }) => c.term === "sehr")).toMatchObject({
      example: "Mir geht's sehr gut.",
      exampleTranslation: "I'm very well.",
    });

    await master(a.cookie, deckId, ["sehr", "gut"]);
    q = await call(queue.GET, { cookie: a.cookie, url: `/api/study/queue?deckId=${deckId}&mode=learn` });
    const sentenceItems = q.json.session.items.filter((i: { kind: string }) => i.kind === "sentence");
    expect(sentenceItems).toHaveLength(1);
    const unlocked = q.json.sentences.find((x: { unlocked: boolean }) => x.unlocked);
    expect(unlocked.text).toBe("Mir geht's sehr gut.");

    const s = await call(queue.GET, { cookie: a.cookie, url: `/api/study/queue?deckId=${deckId}&mode=sentences` });
    expect(s.json.questions).toHaveLength(1);
    expect(s.json.questions[0]).toMatchObject({ sentenceId: unlocked.id, type: "fill_blank" });
    expect(s.json.questions[0].blanked).toContain("___");

    const r = await call(sentenceReview.POST, {
      cookie: a.cookie,
      body: { sentenceId: unlocked.id, mode: "sentences", type: "fill_blank", correct: true, answerGiven: "sehr", tz: 0 },
    });
    expect(r.json.progress.stage).toBe(1);
    const db = await getDb();
    const [p] = await db.select().from(schema.sentenceProgress).where(eq(schema.sentenceProgress.sentenceId, unlocked.id));
    expect(p.stage).toBe(1);
    expect(p.modeStats).toEqual({ fill_blank: { correct: 1, wrong: 0 } });

    // Editing the sentence text restarts its ladder
    const d = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    await call(sentencesRoute.PUT, {
      method: "PUT",
      cookie: a.cookie,
      params: { id: deckId },
      body: { sentences: d.json.sentences.map((x: { id: string; text: string; translation: string }) => ({ id: x.id, text: x.id === unlocked.id ? "Mir geht's sehr, sehr gut." : x.text, translation: x.translation })) },
    });
    expect(await db.select().from(schema.sentenceProgress).where(eq(schema.sentenceProgress.sentenceId, unlocked.id))).toHaveLength(0);
  });

  it("is private: other users get 404, and sentences are copied with a duplicated deck", async () => {
    const a = await registerUser("sent_private");
    const b = await registerUser("sent_intruder");
    const { deckId } = await createDeck(a.cookie, WORDS);
    const r = await call(sentencesRoute.PUT, { method: "PUT", cookie: a.cookie, params: { id: deckId }, body: { sentences: SENTENCES } });
    const sid = r.json.sentences[0].id;
    expect((await call(sentencesRoute.PUT, { method: "PUT", cookie: b.cookie, params: { id: deckId }, body: { sentences: [] } })).status).toBe(404);
    expect(
      (await call(sentenceReview.POST, { cookie: b.cookie, body: { sentenceId: sid, mode: "learn", type: "fill_blank", correct: true } })).status,
    ).toBe(404);
    const copy = await call(duplicate.POST, { method: "POST", cookie: a.cookie, params: { id: deckId } });
    const d = await call(deck.GET, { cookie: a.cookie, params: { id: copy.json.deck.id } });
    expect(d.json.sentences).toHaveLength(3);
    expect(d.json.sentences[1].cardIds).toHaveLength(2);
  });

  it("generates sentences with the user's Gemini key", async () => {
    const a = await registerUser("sent_gen");
    const { deckId } = await createDeck(a.cookie, WORDS);
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ totalTokens: 1 }), { status: 200 })) as typeof fetch;
    await call(geminiKey.PUT, { method: "PUT", cookie: a.cookie, body: { apiKey: "AQ.TestKeyForSentences_1234567890" } });
    let prompt = "";
    globalThis.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify([{ text: "Das ist sehr gut.", translation: "That's very good.", reply: null, replyTranslation: null }]) }] } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const r = await call(genSentences.POST, { cookie: a.cookie, params: { id: deckId }, body: { count: 1 } });
    expect(r.json.sentences).toEqual([{ text: "Das ist sehr gut.", translation: "That's very good.", reply: null, replyTranslation: null }]);
    expect(prompt).toContain("sehr (very)");
  });
});
