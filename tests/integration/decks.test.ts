import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as account from "@/app/api/account/route";
import * as deck from "@/app/api/decks/[id]/route";
import * as decks from "@/app/api/decks/route";
import * as deckCards from "@/app/api/decks/[id]/cards/route";
import * as duplicate from "@/app/api/decks/[id]/duplicate/route";
import * as importRoute from "@/app/api/decks/[id]/import/route";
import * as exportCsv from "@/app/api/decks/[id]/export.csv/route";
import * as resetDeck from "@/app/api/decks/[id]/reset-progress/route";
import * as match from "@/app/api/decks/[id]/match/route";
import * as cardImage from "@/app/api/cards/[id]/image/route";
import * as autoImage from "@/app/api/cards/[id]/auto-image/route";
import * as resetCard from "@/app/api/cards/[id]/reset-progress/route";
import * as review from "@/app/api/review/route";
import * as queue from "@/app/api/study/queue/route";
import * as due from "@/app/api/study/due/route";
import { getDb, schema } from "@/lib/db/client";
import { call } from "../support/route";
import { createDeck, registerUser } from "../support/fixtures";

const WORDS = [
  { term: "la manzana", definition: "apple" },
  { term: "el perro", definition: "dog" },
  { term: "el gato", definition: "cat" },
  { term: "la casa", definition: "house" },
];

const tinyPng = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe("ownership isolation", () => {
  it("user B gets 404 on every deck/card endpoint for user A's resources", async () => {
    const a = await registerUser("owner_a");
    const b = await registerUser("intruder_b");
    const { deckId, cards } = await createDeck(a.cookie, WORDS);
    const cardId = cards[0].id;
    const form = new FormData();
    form.append("file", new Blob([tinyPng()], { type: "image/png" }), "x.png");

    const attempts: [string, unknown, Parameters<typeof call>[1]][] = [
      ["GET deck", deck.GET, { params: { id: deckId } }],
      ["PATCH deck", deck.PATCH, { method: "PATCH", params: { id: deckId }, body: { title: "pwned" } }],
      ["DELETE deck", deck.DELETE, { method: "DELETE", params: { id: deckId } }],
      ["duplicate", duplicate.POST, { method: "POST", params: { id: deckId } }],
      ["PUT cards", deckCards.PUT, { method: "PUT", params: { id: deckId }, body: { cards: [] } }],
      ["import", importRoute.POST, { params: { id: deckId }, body: { text: "a - b", commit: true } }],
      ["export", exportCsv.GET, { params: { id: deckId } }],
      ["reset deck", resetDeck.POST, { method: "POST", params: { id: deckId } }],
      ["match", match.POST, { params: { id: deckId }, body: { timeMs: 1000 } }],
      ["upload image", cardImage.POST, { params: { id: cardId }, form }],
      ["get image", cardImage.GET, { params: { id: cardId } }],
      ["auto image", autoImage.POST, { method: "POST", params: { id: cardId } }],
      ["reset card", resetCard.POST, { method: "POST", params: { id: cardId } }],
      ["review", review.POST, { body: { cardId, mode: "learn", correct: true } }],
      ["queue", queue.GET, { url: `/api/study/queue?deckId=${deckId}&mode=learn` }],
    ];
    for (const [name, handler, opts] of attempts) {
      const r = await call(handler, { ...opts, cookie: b.cookie });
      expect(r.status, name).toBe(404);
    }
    // B's lists don't include A's deck, and A's data is untouched.
    expect((await call(decks.GET, { cookie: b.cookie })).json.decks).toEqual([]);
    const still = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    expect(still.json.deck.title).toBe("Spanish");
    expect(still.json.cards).toHaveLength(4);
  });

  it("returns 404 for malformed ids", async () => {
    const a = await registerUser("owner_c");
    expect((await call(deck.GET, { cookie: a.cookie, params: { id: "not-a-uuid" } })).status).toBe(404);
  });
});

describe("card upsert", () => {
  it("creates, updates, deletes and reorders in one call", async () => {
    const a = await registerUser("editor");
    const { deckId, cards } = await createDeck(a.cookie, WORDS);
    const [apple, dog, cat] = cards;
    const r = await call(deckCards.PUT, {
      method: "PUT",
      cookie: a.cookie,
      params: { id: deckId },
      body: {
        cards: [
          { id: cat.id, term: "el gato", definition: "cat (pet)" }, // updated + moved first
          { term: "el pájaro", definition: "bird" }, // created
          { id: apple.id, term: "la manzana", definition: "apple" }, // moved
          // dog and house deleted
        ],
      },
    });
    expect(r.status).toBe(200);
    expect(r.json.cards.map((c: { term: string }) => c.term)).toEqual(["el gato", "el pájaro", "la manzana"]);
    expect(r.json.cards.map((c: { position: number }) => c.position)).toEqual([0, 1, 2]);
    expect(r.json.cards[0]).toMatchObject({ id: cat.id, definition: "cat (pet)" });
    expect(r.json.cards.find((c: { id: string }) => c.id === dog.id)).toBeUndefined();
  });

  it("rolls back the whole change when one card is invalid", async () => {
    const a = await registerUser("editor2");
    const { deckId } = await createDeck(a.cookie, WORDS);
    const r = await call(deckCards.PUT, {
      method: "PUT",
      cookie: a.cookie,
      params: { id: deckId },
      body: { cards: [{ term: "ok", definition: "ok" }, { term: "", definition: "missing term" }] },
    });
    expect(r.status).toBe(400);
    const d = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    expect(d.json.cards).toHaveLength(4);
  });

  it("ignores ids of cards from another deck (creates instead)", async () => {
    const a = await registerUser("editor3");
    const one = await createDeck(a.cookie, WORDS);
    const two = await createDeck(a.cookie, [{ term: "x", definition: "y" }]);
    await call(deckCards.PUT, {
      method: "PUT",
      cookie: a.cookie,
      params: { id: two.deckId },
      body: { cards: [{ id: one.cards[0].id, term: "hijack", definition: "attempt" }] },
    });
    const d1 = await call(deck.GET, { cookie: a.cookie, params: { id: one.deckId } });
    expect(d1.json.cards[0].term).toBe("la manzana");
  });

  it("imports with preview and commit, exports CSV, duplicates", async () => {
    const a = await registerUser("importer");
    const { deckId } = await createDeck(a.cookie, WORDS);
    const preview = await call(importRoute.POST, { cookie: a.cookie, params: { id: deckId }, body: { text: "uno - one\nbad\ndos, two" } });
    expect(preview.json.rows).toHaveLength(2);
    expect(preview.json.errors).toHaveLength(1);
    const commit = await call(importRoute.POST, { cookie: a.cookie, params: { id: deckId }, body: { text: "uno - one\ndos, two", commit: true } });
    expect(commit.json.added).toBe(2);
    const csv = await call(exportCsv.GET, { cookie: a.cookie, params: { id: deckId } });
    expect(csv.res.headers.get("content-type")).toContain("text/csv");
    expect(csv.text).toContain('"uno","one"');
    const dup = await call(duplicate.POST, { method: "POST", cookie: a.cookie, params: { id: deckId } });
    expect(dup.status).toBe(201);
    const dupDeck = await call(deck.GET, { cookie: a.cookie, params: { id: dup.json.deck.id } });
    expect(dupDeck.json.cards).toHaveLength(6);
    expect(dupDeck.json.deck.title).toBe("Spanish (copy)");
  });

  it("stores uploads validated by magic bytes and serves them with caching headers", async () => {
    const a = await registerUser("uploader");
    const { cards } = await createDeck(a.cookie, WORDS);
    const fake = new FormData();
    fake.append("file", new Blob(["<svg/>"], { type: "image/png" }), "x.png");
    expect((await call(cardImage.POST, { cookie: a.cookie, params: { id: cards[0].id }, form: fake })).status).toBe(415);
    const big = new FormData();
    big.append("file", new Blob([new Uint8Array(160 * 1024)], { type: "image/png" }), "x.png");
    expect((await call(cardImage.POST, { cookie: a.cookie, params: { id: cards[0].id }, form: big })).status).toBe(413);
    const good = new FormData();
    good.append("file", new Blob([tinyPng()], { type: "image/png" }), "x.png");
    const up = await call(cardImage.POST, { cookie: a.cookie, params: { id: cards[0].id }, form: good });
    expect(up.status).toBe(200);
    const img = await call(cardImage.GET, { cookie: a.cookie, params: { id: cards[0].id } });
    expect(img.status).toBe(200);
    expect(img.res.headers.get("content-type")).toBe("image/png");
    expect(img.res.headers.get("etag")).toBeTruthy();
    const cached = await call(cardImage.GET, {
      cookie: a.cookie,
      params: { id: cards[0].id },
      headers: { "if-none-match": img.res.headers.get("etag")! },
    });
    expect(cached.status).toBe(304);
  });
});

describe("review", () => {
  it("updates card_progress and appends to review_log", async () => {
    const a = await registerUser("learner");
    const { deckId, cards } = await createDeck(a.cookie, WORDS);
    const cardId = cards[0].id;
    const view = await call(review.POST, { cookie: a.cookie, body: { cardId, mode: "learn", questionType: "flashcard", correct: true } });
    expect(view.status).toBe(200);
    expect(view.json.progress.stage).toBe(1);
    for (let i = 0; i < 2; i++) {
      await call(review.POST, {
        cookie: a.cookie,
        body: { cardId, mode: "learn", questionType: "mc", correct: true, grade: 4, answerGiven: "apple", responseMs: 2000 },
      });
    }
    const wrong = await call(review.POST, {
      cookie: a.cookie,
      body: { cardId, mode: "learn", questionType: "listen_mc", correct: false, grade: 1, answerGiven: "x", responseMs: 900 },
    });
    expect(wrong.json.progress.stage).toBe(1);
    expect(wrong.json.progress.lapses).toBe(1);

    const db = await getDb();
    const [p] = await db.select().from(schema.cardProgress).where(eq(schema.cardProgress.cardId, cardId));
    expect(p.stage).toBe(1);
    expect(p.modeStats).toMatchObject({ mc: { correct: 2, wrong: 0 }, listen_mc: { correct: 0, wrong: 1 } });
    const logs = await db.select().from(schema.reviewLog).where(eq(schema.reviewLog.cardId, cardId));
    expect(logs).toHaveLength(4);
    expect(logs.find((l) => !l.correct)).toMatchObject({ mode: "learn", answerGiven: "x", responseMs: 900, userId: a.user.id });

    const d = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    expect(d.json.deck.lastStudiedAt).toBeTruthy();
    const dueNow = await call(due.GET, { cookie: a.cookie, url: "/api/study/due?tz=0" });
    expect(dueNow.json.total).toBe(1); // the wrong answer made the card due again
    expect(dueNow.json.streak).toBe(1);
  });

  it("builds a learn queue with distractors from the deck", async () => {
    const a = await registerUser("queuer");
    const { deckId, cards } = await createDeck(a.cookie, WORDS);
    await call(review.POST, { cookie: a.cookie, body: { cardId: cards[0].id, mode: "learn", questionType: "flashcard", correct: true } });
    const q = await call(queue.GET, { cookie: a.cookie, url: `/api/study/queue?deckId=${deckId}&mode=learn&speak=0` });
    expect(q.status).toBe(200);
    const first = q.json.questions[0];
    expect(first).toMatchObject({ cardId: cards[0].id, type: "mc", answer: "apple" });
    expect(first.options).toHaveLength(4);
    expect(q.json.questions.slice(1).every((x: { type: string }) => x.type === "flashcard")).toBe(true);
    const test = await call(queue.GET, { cookie: a.cookie, url: `/api/study/queue?deckId=${deckId}&mode=test&count=3&types=write,true_false` });
    expect(test.json.questions).toHaveLength(3);
  });

  it("resets card and deck progress", async () => {
    const a = await registerUser("resetter");
    const { deckId, cards } = await createDeck(a.cookie, WORDS);
    for (const c of cards) await call(review.POST, { cookie: a.cookie, body: { cardId: c.id, mode: "learn", questionType: "flashcard", correct: true } });
    await call(resetCard.POST, { method: "POST", cookie: a.cookie, params: { id: cards[0].id } });
    let d = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    expect(d.json.cards.map((c: { progress: { stage: number } }) => c.progress.stage)).toEqual([0, 1, 1, 1]);
    await call(resetDeck.POST, { method: "POST", cookie: a.cookie, params: { id: deckId } });
    d = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    expect(d.json.cards.every((c: { progress: { stage: number } }) => c.progress.stage === 0)).toBe(true);
  });

  it("keeps the best Match time", async () => {
    const a = await registerUser("matcher");
    const { deckId } = await createDeck(a.cookie, WORDS);
    expect((await call(match.POST, { cookie: a.cookie, params: { id: deckId }, body: { timeMs: 9000 } })).json).toEqual({ bestMs: 9000, isBest: true });
    expect((await call(match.POST, { cookie: a.cookie, params: { id: deckId }, body: { timeMs: 12000 } })).json).toEqual({ bestMs: 9000, isBest: false });
    expect((await call(match.POST, { cookie: a.cookie, params: { id: deckId }, body: { timeMs: 7000 } })).json.isBest).toBe(true);
  });
});

describe("account deletion", () => {
  it("requires the password and cascades to all user data", async () => {
    const a = await registerUser("leaver");
    const { deckId, cards } = await createDeck(a.cookie, WORDS);
    await call(review.POST, { cookie: a.cookie, body: { cardId: cards[0].id, mode: "learn", questionType: "flashcard", correct: true } });
    expect((await call(account.DELETE, { method: "DELETE", cookie: a.cookie, body: { password: "wrong-password" } })).status).toBe(400);
    const r = await call(account.DELETE, { method: "DELETE", cookie: a.cookie, body: { password: "password123" } });
    expect(r.status).toBe(200);
    const db = await getDb();
    expect(await db.select().from(schema.users).where(eq(schema.users.id, a.user.id))).toHaveLength(0);
    expect(await db.select().from(schema.decks).where(eq(schema.decks.id, deckId))).toHaveLength(0);
    expect(await db.select().from(schema.cards).where(eq(schema.cards.deckId, deckId))).toHaveLength(0);
    expect(await db.select().from(schema.cardProgress).where(eq(schema.cardProgress.cardId, cards[0].id))).toHaveLength(0);
    expect(await db.select().from(schema.reviewLog).where(eq(schema.reviewLog.userId, a.user.id))).toHaveLength(0);
  });
});

describe("limits", () => {
  it("rejects more than 1,000 cards per deck via import", async () => {
    const a = await registerUser("limiter");
    const { deckId } = await createDeck(a.cookie, WORDS);
    const text = Array.from({ length: 997 }, (_, i) => `t${i} - d${i}`).join("\n");
    const r = await call(importRoute.POST, { cookie: a.cookie, params: { id: deckId }, body: { text, commit: true } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("limit_reached");
  });
});
