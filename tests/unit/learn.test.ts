import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  applyFlashcardMark,
  applyView,
  buildOptions,
  buildQuestion,
  buildTest,
  NEW_PROGRESS,
  pickDistractors,
  questionTypeForStage,
  reinsertIndex,
  reviewQuestionType,
  selectRound,
  type Progress,
  type StudyCard,
} from "@/lib/learn";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const rand = seq(0.1, 0.7, 0.3, 0.9, 0.5);
const opts = { advanceAfter: 2, speakAvailable: true };
const at = (stage: number, extra: Partial<Progress> = {}): Progress => ({ ...NEW_PROGRESS, stage, ...extra });
const now = new Date("2026-03-01T10:00:00Z");

function card(i: number, progress: Progress = NEW_PROGRESS, overrides: Partial<StudyCard> = {}): StudyCard {
  return {
    id: `c${i}`,
    deckId: "d1",
    term: `term${i}`,
    definition: `definition number ${i}`,
    example: "",
    imageUrl: null,
    imageAttribution: null,
    termLang: "es-ES",
    definitionLang: "en-US",
    progress,
    ...overrides,
  };
}

describe("ladder", () => {
  it("viewing a new card moves stage 0 → 1", () => {
    const r = applyView(NEW_PROGRESS, now);
    expect(r.progress.stage).toBe(1);
    expect(r.stageChanged).toBe(1);
    expect(applyAnswer(NEW_PROGRESS, { correct: true, type: "flashcard", ladder: true }, opts, now).progress.stage).toBe(1);
  });

  it("moves up after N consecutive correct answers", () => {
    let p = at(1);
    p = applyAnswer(p, { correct: true, type: "mc", ladder: true }, opts, now).progress;
    expect(p.stage).toBe(1);
    expect(p.correctStreak).toBe(1);
    const r = applyAnswer(p, { correct: true, type: "mc", ladder: true }, opts, now);
    expect(r.progress.stage).toBe(2);
    expect(r.progress.correctStreak).toBe(0);
    expect(r.stageChanged).toBe(1);
  });

  it("respects a configurable advance threshold (1 and 3)", () => {
    expect(applyAnswer(at(2), { correct: true, type: "mc", ladder: true }, { ...opts, advanceAfter: 1 }, now).progress.stage).toBe(3);
    let p = at(2);
    for (let i = 0; i < 2; i++) p = applyAnswer(p, { correct: true, type: "mc", ladder: true }, { ...opts, advanceAfter: 3 }, now).progress;
    expect(p.stage).toBe(2);
    p = applyAnswer(p, { correct: true, type: "mc", ladder: true }, { ...opts, advanceAfter: 3 }, now).progress;
    expect(p.stage).toBe(3);
  });

  it("moves down one stage on a wrong answer (min 1) and resets the streak", () => {
    const r = applyAnswer(at(4, { correctStreak: 1 }), { correct: false, type: "write", ladder: true }, opts, now);
    expect(r.progress.stage).toBe(3);
    expect(r.progress.correctStreak).toBe(0);
    expect(r.stageChanged).toBe(-1);
    expect(applyAnswer(at(1), { correct: false, type: "mc", ladder: true }, opts, now).progress.stage).toBe(1);
  });

  it("a mastered card that lapses drops to stage 4", () => {
    const r = applyAnswer(at(6, { reps: 3, intervalDays: 15 }), { correct: false, type: "write", ladder: true }, opts, now);
    expect(r.progress.stage).toBe(4);
    expect(r.progress.lapses).toBe(1);
    expect(r.progress.intervalDays).toBe(1);
  });

  it("skips Speak (stage 5) when speech isn't available: 4 → 6", () => {
    let p = at(4);
    const noSpeak = { advanceAfter: 2, speakAvailable: false };
    p = applyAnswer(p, { correct: true, type: "write", ladder: true }, noSpeak, now).progress;
    p = applyAnswer(p, { correct: true, type: "write", ladder: true }, noSpeak, now).progress;
    expect(p.stage).toBe(6);
    expect(applyAnswer(at(4, { correctStreak: 1 }), { correct: true, type: "write", ladder: true }, opts, now).progress.stage).toBe(5);
  });

  it("graduating to mastered starts SM-2 with a 1-day interval", () => {
    const r = applyAnswer(at(5, { correctStreak: 1 }), { correct: true, type: "speak", ladder: true }, opts, now);
    expect(r.progress.stage).toBe(6);
    expect(r.progress.reps).toBe(0);
    expect(new Date(r.progress.dueAt!).getTime() - now.getTime()).toBe(86_400_000);
  });

  it("non-ladder modes schedule without moving the ladder", () => {
    const r = applyAnswer(at(2), { correct: true, type: "write", ladder: false }, opts, now);
    expect(r.progress.stage).toBe(2);
    expect(r.progress.modeStats.write).toEqual({ correct: 1, wrong: 0 });
  });

  it("flashcards 'Know it' only moves stage 0 → 1", () => {
    expect(applyFlashcardMark(NEW_PROGRESS, true, now).progress.stage).toBe(1);
    expect(applyFlashcardMark(at(3), true, now).progress.stage).toBe(3);
    expect(applyFlashcardMark(NEW_PROGRESS, false, now).progress.stage).toBe(1);
  });

  it("tracks per-mode stats", () => {
    let p = applyAnswer(at(1), { correct: true, type: "mc", ladder: true }, opts, now).progress;
    p = applyAnswer(p, { correct: false, type: "mc", ladder: true }, opts, now).progress;
    expect(p.modeStats.mc).toEqual({ correct: 1, wrong: 1 });
  });
});

describe("question type selection", () => {
  const o = { speakAvailable: true, deckSize: 10, rand };
  it("follows the ladder order", () => {
    expect(questionTypeForStage(0, 0, o)).toBe("flashcard");
    expect(questionTypeForStage(1, 0, o)).toBe("mc");
    expect(questionTypeForStage(2, 0, o)).toBe("listen_mc");
    expect(questionTypeForStage(2, 1, o)).toBe("mc_reverse");
    expect(questionTypeForStage(3, 0, o)).toBe("dictation");
    expect(questionTypeForStage(4, 0, o)).toBe("write");
    expect(questionTypeForStage(5, 0, o)).toBe("speak");
  });
  it("uses Write at stage 5 when speaking is unavailable", () => {
    expect(questionTypeForStage(5, 0, { ...o, speakAvailable: false })).toBe("write");
  });
  it("small decks (≤ 2 cards) skip multiple choice", () => {
    const small = { ...o, deckSize: 2 };
    expect(questionTypeForStage(1, 0, small)).toBe("write");
    expect(questionTypeForStage(2, 0, small)).toBe("dictation");
    expect(questionTypeForStage(2, 1, small)).toBe("write");
    expect(questionTypeForStage(0, 0, small)).toBe("flashcard");
  });
  it("review types are weighted towards production", () => {
    expect(reviewQuestionType(() => 0.0, true, 10)).toBe("write"); // 0–40
    expect(reviewQuestionType(() => 0.5, true, 10)).toBe("speak"); // 40–70
    expect(reviewQuestionType(() => 0.8, true, 10)).toBe("dictation"); // 70–90
    expect(reviewQuestionType(() => 0.95, true, 10)).toBe("mc"); // 90–100
    for (let r = 0; r < 1; r += 0.05) expect(reviewQuestionType(() => r, false, 10)).not.toBe("speak");
  });
});

describe("distractors", () => {
  const pool = ["perro", "gato", "pájaro", "perro", "pez", "caballo", "vaca"];
  it("never includes the correct answer or duplicates", () => {
    const d = pickDistractors("perro", pool, 3, rand);
    expect(d).toHaveLength(3);
    expect(d).not.toContain("perro");
    expect(new Set(d).size).toBe(3);
  });
  it("options include the correct answer exactly once", () => {
    for (let i = 0; i < 20; i++) {
      const options = buildOptions("gato", pool, Math.random);
      expect(options.filter((x) => x === "gato")).toHaveLength(1);
      expect(new Set(options).size).toBe(options.length);
      expect(options.length).toBe(4);
    }
  });
  it("small decks use as many options as exist", () => {
    expect(buildOptions("a", ["a", "b", "c"], rand)).toHaveLength(3);
    expect(buildOptions("a", ["a"], rand)).toEqual(["a"]);
  });
  it("ignores case-insensitive duplicates of the answer", () => {
    expect(pickDistractors("Gato", ["gato", "GATO ", "perro"], 3, rand)).toEqual(["perro"]);
  });
  it("prefers similar length / same first letter", () => {
    const d = pickDistractors("casa", ["cosa", "extraordinariamente", "cama", "independencia", "taza"], 2, () => 0);
    expect(d.sort()).toEqual(["cama", "cosa"]);
  });
  it("buildQuestion produces type-appropriate answers/options", () => {
    const cards = [1, 2, 3, 4, 5].map((i) => card(i));
    const mc = buildQuestion(cards[0], "mc", cards, rand);
    expect(mc.answer).toBe(cards[0].definition);
    expect(mc.options).toContain(cards[0].definition);
    const rev = buildQuestion(cards[0], "mc_reverse", cards, rand);
    expect(rev.answer).toBe("term1");
    expect(rev.options).toContain("term1");
    const tf = buildQuestion(cards[0], "true_false", cards, rand);
    expect(["True", "False"]).toContain(tf.answer);
    expect(tf.isMatch ? tf.shownDefinition === cards[0].definition : tf.shownDefinition !== cards[0].definition).toBe(true);
  });
});

describe("session selection", () => {
  it("orders due → in progress → new (limited)", () => {
    const due = card(1, at(6, { dueAt: "2026-02-01T00:00:00Z" }));
    const notDueMastered = card(2, at(6, { dueAt: "2026-04-01T00:00:00Z" }));
    const learning = card(3, at(2, { dueAt: "2026-04-01T00:00:00Z" }));
    const new1 = card(4);
    const new2 = card(5);
    const round = selectRound([new1, learning, notDueMastered, due, new2], { now, newAllowed: 1, roundSize: 7 });
    expect(round.map((c) => c.id)).toEqual(["c1", "c3", "c4"]);
  });
  it("respects the round size", () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(i));
    expect(selectRound(cards, { now, newAllowed: 10, roundSize: 7 })).toHaveLength(7);
  });
  it("is empty when everything is mastered and not due", () => {
    const cards = [card(1, at(6, { dueAt: "2026-05-01T00:00:00Z" }))];
    expect(selectRound(cards, { now, newAllowed: 10, roundSize: 7 })).toHaveLength(0);
  });
  it("wrong answers come back 3–5 questions later", () => {
    for (const r of [0, 0.5, 0.99]) {
      const idx = reinsertIndex(2, 20, () => r);
      expect(idx).toBeGreaterThanOrEqual(5);
      expect(idx).toBeLessThanOrEqual(7);
    }
    expect(reinsertIndex(5, 6, () => 0)).toBe(6);
  });
});

describe("test generation", () => {
  const cards = Array.from({ length: 8 }, (_, i) => card(i));
  it("builds the requested number of questions with the requested types", () => {
    const qs = buildTest(cards, { count: 5, types: ["mc", "write", "true_false"], speakAvailable: true }, rand);
    expect(qs).toHaveLength(5);
    expect(new Set(qs.map((q) => q.cardId)).size).toBe(5);
    for (const q of qs) expect(["mc", "write", "true_false"]).toContain(q.type);
  });
  it("drops speak when unavailable and mc for tiny decks", () => {
    expect(buildTest(cards, { count: 4, types: ["speak"], speakAvailable: false }, rand).every((q) => q.type === "write")).toBe(true);
    const two = cards.slice(0, 2);
    expect(buildTest(two, { count: 2, types: ["mc"], speakAvailable: true }, rand).every((q) => q.type === "write")).toBe(true);
  });
});
