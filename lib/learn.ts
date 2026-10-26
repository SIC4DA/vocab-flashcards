/**
 * Learning ladder (stages 0–6), question selection and distractors. Pure and shared by
 * server (queue building, review updates) and client (adaptive next question).
 */
import { DAY_MS, dueDate, gradeFor, isDue, learningStep, sm2, type Grade, type SrsState } from "./srs";

export const STAGE_NAMES = ["New", "Seen", "Recognized", "Heard", "Written", "Spoken", "Mastered"] as const;
export const MAX_STAGE = 6;

export type QuestionType =
  | "flashcard"
  | "mc"
  | "mc_reverse"
  | "listen_mc"
  | "dictation"
  | "write"
  | "speak"
  | "true_false";

export const QUESTION_LABELS: Record<QuestionType, string> = {
  flashcard: "Flashcard",
  mc: "Multiple choice",
  mc_reverse: "Multiple choice (reverse)",
  listen_mc: "Listening",
  dictation: "Listen & write",
  write: "Write",
  speak: "Speak",
  true_false: "True / False",
};

export type ModeStats = Record<string, { correct: number; wrong: number }>;

export type Progress = SrsState & {
  stage: number;
  correctStreak: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
  modeStats: ModeStats;
};

export const NEW_PROGRESS: Progress = {
  stage: 0,
  correctStreak: 0,
  ease: 2.5,
  intervalDays: 0,
  reps: 0,
  lapses: 0,
  dueAt: null,
  lastReviewedAt: null,
  modeStats: {},
};

export type StudyCard = {
  id: string;
  deckId: string;
  term: string;
  definition: string;
  example: string;
  imageUrl: string | null;
  imageAttribution: string | null;
  termLang: string;
  definitionLang: string;
  progress: Progress;
};

export type Question = {
  key: string;
  cardId: string;
  type: QuestionType;
  /** Multiple-choice options (terms or definitions depending on the type). */
  options?: string[];
  /** The string the learner must produce/choose. */
  answer: string;
  /** For true/false questions: the definition shown with the term and whether it matches. */
  shownDefinition?: string;
  isMatch?: boolean;
};

export type LadderOptions = {
  advanceAfter: number; // 1–3
  speakAvailable: boolean;
};

export type Rand = () => number;

let keyCounter = 0;
const nextKey = () => `q${Date.now().toString(36)}${(keyCounter++).toString(36)}`;

/* ------------------------------------------------------------------ */
/* Question type selection                                            */
/* ------------------------------------------------------------------ */

/** Multiple choice needs at least 3 cards; with ≤ 2, use flashcard + write instead. */
export function canUseMultipleChoice(deckSize: number) {
  return deckSize > 2;
}

function downgradeForSmallDeck(type: QuestionType, deckSize: number): QuestionType {
  if (canUseMultipleChoice(deckSize)) return type;
  if (type === "mc" || type === "mc_reverse") return "write";
  if (type === "listen_mc") return "dictation";
  return type;
}

/** Review question type for mastered cards: Write 40%, Speak 30%, Listen & write 20%, MC 10%. */
export function reviewQuestionType(rand: Rand, speakAvailable: boolean, deckSize: number): QuestionType {
  const weights: [QuestionType, number][] = [
    ["write", 40],
    ["speak", speakAvailable ? 30 : 0],
    ["dictation", 20],
    ["mc", canUseMultipleChoice(deckSize) ? 10 : 0],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [type, w] of weights) {
    if (w === 0) continue;
    if (r < w) return type;
    r -= w;
  }
  return "write";
}

export function questionTypeForStage(
  stage: number,
  correctStreak: number,
  opts: { speakAvailable: boolean; deckSize: number; rand: Rand },
): QuestionType {
  let type: QuestionType;
  switch (stage) {
    case 0:
      return "flashcard";
    case 1:
      type = "mc";
      break;
    case 2:
      type = correctStreak % 2 === 0 ? "listen_mc" : "mc_reverse";
      break;
    case 3:
      type = "dictation";
      break;
    case 4:
      type = "write";
      break;
    case 5:
      type = opts.speakAvailable ? "speak" : "write";
      break;
    default:
      type = reviewQuestionType(opts.rand, opts.speakAvailable, opts.deckSize);
  }
  return downgradeForSmallDeck(type, opts.deckSize);
}

/* ------------------------------------------------------------------ */
/* Distractors                                                        */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();

export function shuffle<T>(items: T[], rand: Rand): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick up to `count` distractor strings from the pool (same deck), never equal to the
 * correct answer and never duplicated. Prefers similar length / same first letter.
 */
export function pickDistractors(correct: string, pool: string[], count: number, rand: Rand): string[] {
  const seen = new Set([norm(correct)]);
  const candidates: { value: string; score: number }[] = [];
  for (const value of pool) {
    const n = norm(value);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const lenDiff = Math.abs(value.length - correct.length);
    const sameFirst = n[0] === norm(correct)[0] ? 3 : 0;
    candidates.push({ value, score: lenDiff - sameFirst + rand() * 2 });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, count).map((c) => c.value);
}

/** Options = correct answer + up to 3 distractors, shuffled; correct is included exactly once. */
export function buildOptions(correct: string, pool: string[], rand: Rand, total = 4): string[] {
  return shuffle([correct, ...pickDistractors(correct, pool, total - 1, rand)], rand);
}

/* ------------------------------------------------------------------ */
/* Question building                                                  */
/* ------------------------------------------------------------------ */

export function buildQuestion(card: StudyCard, type: QuestionType, deckCards: StudyCard[], rand: Rand): Question {
  const others = deckCards.filter((c) => c.id !== card.id);
  const q: Question = { key: nextKey(), cardId: card.id, type, answer: card.term };
  switch (type) {
    case "mc":
      q.answer = card.definition;
      q.options = buildOptions(card.definition, others.map((c) => c.definition), rand);
      break;
    case "mc_reverse":
    case "listen_mc":
      q.options = buildOptions(card.term, others.map((c) => c.term), rand);
      break;
    case "true_false": {
      const wrong = pickDistractors(card.definition, others.map((c) => c.definition), 1, rand)[0];
      const isMatch = !wrong || rand() < 0.5;
      q.isMatch = isMatch;
      q.shownDefinition = isMatch ? card.definition : wrong;
      q.answer = isMatch ? "True" : "False";
      break;
    }
    default:
      break;
  }
  return q;
}

/* ------------------------------------------------------------------ */
/* Ladder + scheduling                                                */
/* ------------------------------------------------------------------ */

export type AnswerInput = {
  correct: boolean;
  grade?: Grade;
  type: QuestionType;
  /** "learn" / "review" use the ladder; other modes only schedule. */
  ladder: boolean;
  responseMs?: number;
};

export type AnswerResult = { progress: Progress; previousStage: number; stageChanged: -1 | 0 | 1 };

function bumpStats(stats: ModeStats, key: string, correct: boolean): ModeStats {
  const cur = stats[key] ?? { correct: 0, wrong: 0 };
  return { ...stats, [key]: correct ? { ...cur, correct: cur.correct + 1 } : { ...cur, wrong: cur.wrong + 1 } };
}

function nextStageUp(stage: number, speakAvailable: boolean): number {
  const next = stage + 1;
  if (next === 5 && !speakAvailable) return 6;
  return Math.min(MAX_STAGE, next);
}

function schedule(p: Progress, stageForSchedule: number, grade: Grade, now: Date) {
  const s: SrsState = { ease: p.ease, intervalDays: p.intervalDays, reps: p.reps, lapses: p.lapses };
  const next = stageForSchedule >= MAX_STAGE ? sm2(s, grade) : learningStep(s, grade);
  return { ...next, dueAt: dueDate(now, next.intervalDays).toISOString() };
}

/** Viewing a new card (stage 0 flashcard) moves it to stage 1. */
export function applyView(p: Progress, now: Date = new Date()): AnswerResult {
  const previousStage = p.stage;
  if (p.stage > 0) return { progress: { ...p, lastReviewedAt: now.toISOString() }, previousStage, stageChanged: 0 };
  const progress: Progress = {
    ...p,
    ...schedule(p, 1, 4, now),
    stage: 1,
    correctStreak: 0,
    lastReviewedAt: now.toISOString(),
    modeStats: bumpStats(p.modeStats, "flashcard", true),
  };
  return { progress, previousStage, stageChanged: 1 };
}

/** Flashcards mode: "Know it" = grade 4 review (stage 0 → 1 only); "Still learning" = seen only. */
export function applyFlashcardMark(p: Progress, known: boolean, now: Date = new Date()): AnswerResult {
  const previousStage = p.stage;
  const stage = p.stage === 0 ? 1 : p.stage;
  const progress: Progress = {
    ...p,
    ...(known ? schedule(p, p.stage, 4, now) : { dueAt: p.dueAt ?? now.toISOString() }),
    stage,
    lastReviewedAt: now.toISOString(),
    modeStats: bumpStats(p.modeStats, "flashcards", known),
  };
  return { progress, previousStage, stageChanged: stage > previousStage ? 1 : 0 };
}

export function applyAnswer(
  p: Progress,
  input: AnswerInput,
  opts: LadderOptions,
  now: Date = new Date(),
): AnswerResult {
  if (input.type === "flashcard") return applyView(p, now);
  const previousStage = p.stage;
  const grade = input.grade ?? gradeFor(input.correct ? "correct" : "wrong", input.responseMs);
  const correct = input.correct && grade >= 3;
  let stage = p.stage;
  let streak = p.correctStreak;

  if (correct) {
    if (input.ladder && stage < MAX_STAGE) {
      streak += 1;
      if (stage === 0) {
        stage = 1;
        streak = 0;
      } else if (streak >= opts.advanceAfter) {
        stage = nextStageUp(stage, opts.speakAvailable);
        streak = 0;
      }
    } else if (stage === 0) {
      stage = 1;
    }
  } else {
    streak = 0;
    if (stage >= MAX_STAGE) stage = 4;
    else if (input.ladder) stage = Math.max(1, stage - 1);
    else stage = Math.max(1, stage);
  }

  const scheduleStage = previousStage >= MAX_STAGE ? MAX_STAGE : stage;
  let sched = schedule(p, scheduleStage, correct ? grade : (Math.min(grade, 2) as Grade), now);
  // Graduating to mastered starts SM-2 fresh (first interval = 1 day).
  if (stage === MAX_STAGE && previousStage < MAX_STAGE) {
    sched = { ...sched, reps: 0, intervalDays: 1, dueAt: dueDate(now, 1).toISOString() };
  }
  const progress: Progress = {
    ...p,
    ...sched,
    stage,
    correctStreak: streak,
    lastReviewedAt: now.toISOString(),
    modeStats: bumpStats(p.modeStats, input.type, correct),
  };
  return { progress, previousStage, stageChanged: stage > previousStage ? 1 : stage < previousStage ? -1 : 0 };
}

/* ------------------------------------------------------------------ */
/* Session selection                                                  */
/* ------------------------------------------------------------------ */

export function isCardDue(c: StudyCard, now: Date = new Date()) {
  return c.progress.stage >= 1 && isDue(c.progress.dueAt, now);
}

/**
 * Learn candidates in priority order: due cards first, then cards in progress,
 * then new cards (limited by `newAllowed`).
 */
export function selectLearnCandidates(cards: StudyCard[], opts: { now: Date; newAllowed: number }): StudyCard[] {
  const due = cards
    .filter((c) => isCardDue(c, opts.now))
    .sort((a, b) => new Date(a.progress.dueAt!).getTime() - new Date(b.progress.dueAt!).getTime());
  const dueIds = new Set(due.map((c) => c.id));
  const inProgress = cards
    .filter((c) => !dueIds.has(c.id) && c.progress.stage >= 1 && c.progress.stage < MAX_STAGE)
    .sort((a, b) => a.progress.stage - b.progress.stage);
  const fresh = cards.filter((c) => c.progress.stage === 0).slice(0, Math.max(0, opts.newAllowed));
  return [...due, ...inProgress, ...fresh];
}

export function selectRound(
  cards: StudyCard[],
  opts: { now: Date; newAllowed: number; roundSize: number },
): StudyCard[] {
  return selectLearnCandidates(cards, opts).slice(0, opts.roundSize);
}

/** Where to put a card that was answered wrong: 3–5 questions later. */
export function reinsertIndex(currentIndex: number, queueLength: number, rand: Rand): number {
  const offset = 3 + Math.floor(rand() * 3);
  return Math.min(queueLength, currentIndex + offset);
}

/* ------------------------------------------------------------------ */
/* Test generation                                                    */
/* ------------------------------------------------------------------ */

export type TestType = "mc" | "write" | "dictation" | "speak" | "true_false";

export function buildTest(
  cards: StudyCard[],
  opts: { count: number; types: TestType[]; speakAvailable: boolean },
  rand: Rand,
): Question[] {
  let types = opts.types.filter((t) => (t === "speak" ? opts.speakAvailable : true));
  if (!canUseMultipleChoice(cards.length)) types = types.filter((t) => t !== "mc");
  if (cards.length < 2) types = types.filter((t) => t !== "true_false");
  if (types.length === 0) types = ["write"];
  const picked = shuffle(cards, rand).slice(0, Math.max(1, Math.min(opts.count, cards.length)));
  return picked.map((card, i) => buildQuestion(card, types[i % types.length], cards, rand));
}

export function masteredCount(cards: { progress: Progress }[]) {
  return cards.filter((c) => c.progress.stage >= MAX_STAGE).length;
}

export function stageBuckets(cards: { progress: Progress }[]) {
  let fresh = 0,
    learning = 0,
    mastered = 0;
  for (const c of cards) {
    if (c.progress.stage === 0) fresh++;
    else if (c.progress.stage >= MAX_STAGE) mastered++;
    else learning++;
  }
  return { new: fresh, learning, mastered };
}

export { DAY_MS };
