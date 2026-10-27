import { describe, expect, it } from "vitest";
import { MAX_STAGE, NEW_PROGRESS, type Progress } from "@/lib/learn";
import {
  applySentenceAnswer,
  buildSentenceQuestion,
  isUnlocked,
  linkWords,
  orderChunks,
  orderCorrect,
  parseSentenceImport,
  planSentences,
  SENTENCE_MASTERED,
  sentenceDoneToday,
  sentenceTypeForStage,
  tokenize,
  wordMatches,
  type StudySentence,
} from "@/lib/sentences";

const now = new Date("2026-03-01T10:00:00Z");
const today = "2026-03-01";
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

const deck = [
  { id: "nicht", term: "nicht" },
  { id: "sehr", term: "sehr" },
  { id: "gut", term: "gut" },
  { id: "kommen", term: "kommen" },
  { id: "woher", term: "woher" },
  { id: "heissen", term: "heißen" },
  { id: "gehen", term: "gehen" },
  { id: "hund", term: "der Hund" },
  { id: "guten-morgen", term: "guten Morgen" },
];

describe("linking sentences to deck words", () => {
  it("tokenizes words, keeping clitics together", () => {
    expect(tokenize("Mir geht's sehr gut.").map((t) => t.raw)).toEqual(["Mir", "geht's", "sehr", "gut"]);
  });
  it("matches inflected forms of longer words, but short words only exactly", () => {
    expect(wordMatches("kommst", "kommen")).toBe(true);
    expect(wordMatches("heißt".normalize(), "heißen")).toBe(true);
    expect(wordMatches("geht's", "gehen")).toBe(true);
    expect(wordMatches("sehen", "sehr")).toBe(false);
    expect(wordMatches("gute", "gut")).toBe(false);
    expect(wordMatches("komisch", "kommen")).toBe(false);
  });
  it("finds the deck words in a sentence", () => {
    const ids = (t: string) => linkWords(t, deck, "de-DE").map((l) => l.cardId);
    expect(ids("Mir geht's sehr gut.")).toEqual(["gehen", "sehr", "gut"]);
    expect(ids("Woher kommst du?")).toEqual(["woher", "kommen"]);
    expect(ids("Wie heißt du?")).toEqual(["heissen"]);
    expect(ids("Der Hund ist nicht gut.")).toEqual(["hund", "nicht", "gut"]);
    expect(ids("Guten Morgen, Anna!")).toEqual(["guten-morgen"]);
    expect(ids("Ich trinke Kaffee.")).toEqual([]);
  });
});

describe("sentence import", () => {
  it("parses sentences, translations and question/reply pairs", () => {
    const r = parseSentenceImport(
      "Mir geht's sehr gut. | I'm very well.\nWoher kommst du?\nWie heißt du? | What's your name? >> Ich heiße Anna. | My name is Anna.\n\nWie geht's dir?\t>> Mir geht's gut.",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 1, text: "Mir geht's sehr gut.", translation: "I'm very well.", reply: null, replyTranslation: null },
      { line: 2, text: "Woher kommst du?", translation: "", reply: null, replyTranslation: null },
      { line: 3, text: "Wie heißt du?", translation: "What's your name?", reply: "Ich heiße Anna.", replyTranslation: "My name is Anna." },
      { line: 5, text: "Wie geht's dir?", translation: "", reply: "Mir geht's gut.", replyTranslation: null },
    ]);
  });
  it("reports bad lines", () => {
    const r = parseSentenceImport("Hallo\nA >> \nx >> y >> z");
    expect(r.rows).toHaveLength(0);
    expect(r.errors.map((e) => e.reason)).toEqual([
      "A sentence needs at least 2 words",
      "Missing question or reply",
      "Use “>>” only once (question >> reply)",
    ]);
  });
});

describe("unlocking", () => {
  const stages = new Map([
    ["a", MAX_STAGE],
    ["b", 4],
  ]);
  it("unlocks only when every deck word in it is mastered", () => {
    expect(isUnlocked(["a"], (id) => stages.get(id), true)).toBe(true);
    expect(isUnlocked(["a", "b"], (id) => stages.get(id), true)).toBe(false);
  });
  it("a sentence with no deck words unlocks after the first mastered word", () => {
    expect(isUnlocked([], () => undefined, false)).toBe(false);
    expect(isUnlocked([], () => undefined, true)).toBe(true);
  });
});

describe("sentence ladder", () => {
  const at = (stage: number, extra: Partial<Progress> = {}): Progress => ({ ...NEW_PROGRESS, stage, ...extra });
  it("goes fill in the blank → sentence → word order → Q&A → mastered", () => {
    const s = { reply: "Ich heiße Anna." };
    expect([0, 1, 2, 3].map((st) => sentenceTypeForStage(s, st, () => 0.9))).toEqual(["fill_blank", "sentence_read", "word_order", "qa_match"]);
    let p = at(0);
    for (const type of ["fill_blank", "sentence_read", "word_order", "qa_match"] as const) {
      p = applySentenceAnswer(p, { correct: true, type, hasReply: true }, { today }, now);
    }
    expect(p.stage).toBe(SENTENCE_MASTERED);
  });
  it("skips Q&A for sentences without a reply", () => {
    expect(applySentenceAnswer(at(2), { correct: true, type: "word_order", hasReply: false }, { today }, now).stage).toBe(SENTENCE_MASTERED);
    expect(sentenceTypeForStage({ reply: null }, 3, () => 0)).toBe("word_order");
  });
  it("a mistake moves back one step; a mastered sentence drops to word order", () => {
    expect(applySentenceAnswer(at(2), { correct: false, type: "word_order", hasReply: false }, { today }, now).stage).toBe(1);
    expect(applySentenceAnswer(at(0), { correct: false, type: "fill_blank", hasReply: false }, { today }, now).stage).toBe(0);
    expect(applySentenceAnswer(at(4, { reps: 2 }), { correct: false, type: "fill_blank", hasReply: false }, { today }, now).stage).toBe(2);
  });
  it("follows the same daily limits as words", () => {
    let p = applySentenceAnswer(at(0), { correct: true, type: "fill_blank", hasReply: true }, { today }, now);
    expect(sentenceDoneToday(p, false, today, 2)).toBe(false);
    p = applySentenceAnswer(p, { correct: true, type: "sentence_read", hasReply: true }, { today }, now);
    expect(sentenceDoneToday(p, false, today, 2)).toBe(true);
    expect(sentenceDoneToday(p, false, "2026-03-02", 2)).toBe(false);
  });
});

describe("planning and exercises", () => {
  const sentence = (id: string, text: string, extra: Partial<StudySentence> = {}): StudySentence => ({
    id,
    deckId: "d",
    text,
    translation: "",
    reply: null,
    replyTranslation: null,
    cardIds: [],
    termLang: "de-DE",
    definitionLang: "en-US",
    unlocked: true,
    progress: { ...NEW_PROGRESS },
    ...extra,
  });
  it("plans reviews, then sentences in progress, then new unlocked ones — never locked ones", () => {
    const list = [
      sentence("new", "Woher kommst du?"),
      sentence("locked", "Wie heißt du?", { unlocked: false }),
      sentence("learning", "Mir geht's gut.", { progress: { ...NEW_PROGRESS, stage: 2 } }),
      sentence("review", "Guten Morgen, Anna!", { progress: { ...NEW_PROGRESS, stage: 4, dueAt: "2026-02-20T00:00:00Z" } }),
    ];
    expect(planSentences(list, { now, today, stepsPerDay: 2, limit: 5 }).map((s) => s.id)).toEqual(["review", "learning", "new"]);
    expect(planSentences(list, { now, today, stepsPerDay: 2, limit: 1 }).map((s) => s.id)).toEqual(["review"]);
  });
  it("fill in the blank hides a deck word and offers it among distractors", () => {
    const s = sentence("s", "Mir geht's sehr gut.", { cardIds: ["sehr"] });
    const q = buildSentenceQuestion(s, "fill_blank", {
      cards: deck.map((c) => ({ ...c, termLang: "de-DE" })),
      peers: [],
      rand: seq(0.1, 0.5, 0.9),
    });
    expect(q.blanked).toBe("Mir geht's ___ gut.");
    expect(q.answer).toBe("sehr");
    expect(q.options).toContain("sehr");
    expect(q.options).toHaveLength(3);
    expect(new Set(q.options).size).toBe(3);
  });
  it("word order scrambles the sentence and checks the order", () => {
    const s = sentence("s", "Woher kommst du?");
    const q = buildSentenceQuestion(s, "word_order", { cards: [], peers: [], rand: seq(0.1, 0.7, 0.3) });
    expect(q.solution).toEqual(["Woher", "kommst", "du"]);
    expect([...q.chunks!].sort()).toEqual(["Woher", "du", "kommst"]);
    expect(q.chunks).not.toEqual(q.solution);
    expect(orderCorrect(["woher", "kommst", "du"], q.solution!)).toBe(true);
    expect(orderCorrect(["du", "kommst", "woher"], q.solution!)).toBe(false);
    expect(orderChunks("Ich habe heute leider keine Zeit für dich, sorry.")).toHaveLength(5);
  });
  it("fill in the blank uses the reply when the question has no deck words", () => {
    const s = sentence("q", "Wie geht's dir?", { reply: "Mir geht's gut.", replyTranslation: "I'm fine.", cardIds: ["gut"] });
    const q = buildSentenceQuestion(s, "fill_blank", { cards: deck.map((c) => ({ ...c, termLang: "de-DE" })), peers: [], rand: seq(0.2) });
    expect(q.context).toBe("Wie geht's dir?");
    expect(q.blanked).toBe("Mir geht's ___.");
    expect(q.answer).toBe("gut");
    expect(q.blankTranslation).toBe("I'm fine.");
  });
  it("with a single pair, Q&A asks to pick the right reply", () => {
    const own = sentence("a", "Wie heißt du?", { reply: "Ich heiße Anna." });
    const q = buildSentenceQuestion(own, "qa_match", { cards: [], peers: [own, sentence("x", "Woher kommst du?"), sentence("y", "Mir geht's gut.")], rand: seq(0.3, 0.6) });
    expect(q.answer).toBe("Ich heiße Anna.");
    expect(q.options).toHaveLength(3);
    expect(q.options).toContain("Ich heiße Anna.");
    expect(q.options).toContain("Woher kommst du?"); // questions are preferred as wrong replies
  });
  it("Q&A matching pairs this sentence with other question/reply pairs", () => {
    const own = sentence("a", "Wie heißt du?", { reply: "Ich heiße Anna." });
    const peers = [own, sentence("b", "Wie geht's dir?", { reply: "Mir geht's gut." }), sentence("c", "Woher kommst du?")];
    const q = buildSentenceQuestion(own, "qa_match", { cards: [], peers, rand: seq(0.3) });
    expect(q.pairs).toEqual([
      { id: "a", question: "Wie heißt du?", answer: "Ich heiße Anna." },
      { id: "b", question: "Wie geht's dir?", answer: "Mir geht's gut." },
    ]);
  });
});
