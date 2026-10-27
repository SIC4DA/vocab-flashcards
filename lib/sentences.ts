/**
 * Sentences: linking to deck words, import parsing, unlocking, the sentence ladder and
 * exercise building (fill-in-the-blank, sentence card, word order, question & answer). Pure.
 */
import { getLanguage } from "./languages";
import {
  bumpStats,
  dayCounters,
  doneToday,
  MAX_STAGE,
  SENTENCE_MAX_STAGE,
  NEW_PROGRESS,
  schedule,
  shuffle,
  type Progress,
  type Rand,
} from "./learn";
import { dueDate, gradeFor, isDue, type Grade } from "./srs";
import { stripDiacritics } from "./text";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type SentenceType = "fill_blank" | "sentence_read" | "word_order" | "qa_match";

export const SENTENCE_STAGE_NAMES = ["New", "Filled in", "Read", "Ordered", "Mastered"] as const;
/** Sentence ladder: 0 fill-in-the-blank → 1 sentence card → 2 word order → 3 Q&A matching (pairs only) → 4 mastered. */
export const SENTENCE_MASTERED = SENTENCE_MAX_STAGE;

export const SENTENCE_LABELS: Record<SentenceType, string> = {
  fill_blank: "Fill in the blank",
  sentence_read: "Sentence",
  word_order: "Word order",
  qa_match: "Question & answer",
};

export type StudySentence = {
  id: string;
  deckId: string;
  text: string;
  translation: string;
  reply: string | null;
  replyTranslation: string | null;
  /** Deck words that appear in the sentence. */
  cardIds: string[];
  termLang: string;
  definitionLang: string;
  unlocked: boolean;
  progress: Progress;
};

export type SentenceQuestion = {
  key: string;
  sentenceId: string;
  type: SentenceType;
  /** fill_blank: the sentence with "___" in place of the word, the word, and the options. */
  blanked?: string;
  /** fill_blank on a reply: the question shown above it ("Wie geht's dir?"), and the blanked reply's translation. */
  context?: string;
  blankTranslation?: string;
  answer?: string;
  options?: string[];
  /** word_order: the chunks in shuffled order and in the right order. */
  chunks?: string[];
  solution?: string[];
  /** qa_match: question/answer pairs (the current sentence's pair first). With fewer than 2 pairs, `options` holds replies to choose from instead. */
  pairs?: { id: string; question: string; answer: string }[];
};

/* ------------------------------------------------------------------ */
/* Tokens & linking                                                   */
/* ------------------------------------------------------------------ */

export type Token = { raw: string; norm: string; start: number; end: number };

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export const normWord = (s: string) => stripDiacritics(s.normalize("NFC").toLocaleLowerCase()).replace(/’/g, "'");

export function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(WORD_RE), (m) => ({
    raw: m[0],
    norm: normWord(m[0]),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

function commonPrefix(a: string, b: string) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Does a sentence token belong to a dictionary word? Exact match (ignoring case/accents and a
 * clitic like geht's → geht), or — for words of 5+ letters — the same stem with a different
 * ending (kommen ↔ kommst, heißen ↔ heißt, gehen ↔ geht). Short words must match exactly.
 */
export function wordMatches(tokenNorm: string, termWordNorm: string): boolean {
  const token = tokenNorm.split("'")[0];
  if (tokenNorm === termWordNorm || token === termWordNorm) return true;
  const L = termWordNorm.length;
  if (L < 5) return false;
  if (Math.abs(token.length - L) > 3) return false;
  return commonPrefix(token, termWordNorm) >= Math.max(3, L - 2);
}

/** The term's words without a leading article ("der Hund" → ["hund"]). */
export function termWords(term: string, lang: string): string[] {
  let t = term.trim();
  for (const art of getLanguage(lang).articles ?? []) {
    const a = art.toLowerCase();
    if (a.endsWith("'") && t.toLowerCase().startsWith(a) && t.length > a.length) {
      t = t.slice(a.length);
      break;
    }
    if (t.toLowerCase().startsWith(`${a} `)) {
      t = t.slice(a.length + 1);
      break;
    }
  }
  return tokenize(t.split(/[/;]/)[0]).map((x) => x.norm);
}

export type WordLink = { cardId: string; tokenIndex: number; length: number };

/** Find deck words inside a sentence (first occurrence of each). */
export function linkWords(text: string, cards: { id: string; term: string }[], lang: string): WordLink[] {
  const tokens = tokenize(text);
  const links: WordLink[] = [];
  for (const card of cards) {
    const words = termWords(card.term, lang);
    if (words.length === 0) continue;
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (words.every((w, j) => wordMatches(tokens[i + j].norm, w))) {
        links.push({ cardId: card.id, tokenIndex: i, length: words.length });
        break;
      }
    }
  }
  return links.sort((a, b) => a.tokenIndex - b.tokenIndex);
}

/* ------------------------------------------------------------------ */
/* Import                                                             */
/* ------------------------------------------------------------------ */

export type ParsedSentence = { line: number; text: string; translation: string; reply: string | null; replyTranslation: string | null };

function splitPart(part: string): { text: string; translation: string } {
  const idx = part.indexOf("\t") >= 0 ? part.indexOf("\t") : part.indexOf(" | ");
  if (idx < 0) return { text: part.trim(), translation: "" };
  const sep = part[idx] === "\t" ? 1 : 3;
  return { text: part.slice(0, idx).trim(), translation: part.slice(idx + sep).trim() };
}

/**
 * One sentence per line: `sentence | translation` (or a tab; the translation is optional).
 * Question & answer pairs: `question | translation >> reply | translation`.
 */
export function parseSentenceImport(input: string): { rows: ParsedSentence[]; errors: { line: number; text: string; reason: string }[] } {
  const rows: ParsedSentence[] = [];
  const errors: { line: number; text: string; reason: string }[] = [];
  input.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const [q, r, ...rest] = raw.split(">>");
    if (rest.length) {
      errors.push({ line, text: raw, reason: "Use “>>” only once (question >> reply)" });
      return;
    }
    const first = splitPart(q);
    const second = r !== undefined ? splitPart(r) : null;
    if (!first.text || (second && !second.text)) {
      errors.push({ line, text: raw, reason: second ? "Missing question or reply" : "Missing sentence" });
      return;
    }
    if (first.text.length > 300 || (second && second.text.length > 300) || first.translation.length > 300) {
      errors.push({ line, text: raw, reason: "Too long (max 300 characters)" });
      return;
    }
    if (tokenize(first.text).length < 2) {
      errors.push({ line, text: raw, reason: "A sentence needs at least 2 words" });
      return;
    }
    rows.push({
      line,
      text: first.text,
      translation: first.translation,
      reply: second?.text ?? null,
      replyTranslation: second ? second.translation || null : null,
    });
  });
  return { rows, errors };
}

/* ------------------------------------------------------------------ */
/* Unlocking                                                          */
/* ------------------------------------------------------------------ */

/**
 * A sentence unlocks when every deck word in it is Mastered. A sentence that contains none of
 * the deck's words unlocks once at least one word of the deck is Mastered.
 */
export function isUnlocked(cardIds: string[], stageOf: (cardId: string) => number | undefined, anyMastered: boolean): boolean {
  const known = cardIds.filter((id) => stageOf(id) !== undefined);
  if (known.length === 0) return anyMastered;
  return known.every((id) => (stageOf(id) ?? 0) >= MAX_STAGE);
}

/* ------------------------------------------------------------------ */
/* Ladder & scheduling                                                */
/* ------------------------------------------------------------------ */

export function sentenceTypeForStage(s: Pick<StudySentence, "reply">, stage: number, rand: Rand): SentenceType {
  switch (stage) {
    case 0:
      return "fill_blank";
    case 1:
      return "sentence_read";
    case 2:
      return "word_order";
    case 3:
      return s.reply ? "qa_match" : "word_order";
    default: {
      // Reviews: mostly word order, then fill-in-the-blank, plus Q&A for pairs.
      const r = rand();
      if (s.reply && r < 0.3) return "qa_match";
      return r < 0.65 ? "word_order" : "fill_blank";
    }
  }
}

function nextSentenceStage(stage: number, hasReply: boolean) {
  if (stage === 2 && !hasReply) return SENTENCE_MASTERED; // no Q&A step without a reply
  return Math.min(SENTENCE_MASTERED, stage + 1);
}

/** One correct answer moves a sentence up a step; a mistake moves it back one (min 0). */
export function applySentenceAnswer(
  p: Progress,
  input: { correct: boolean; type: SentenceType; hasReply: boolean; responseMs?: number },
  opts: { today?: string },
  now: Date = new Date(),
): Progress {
  const grade: Grade = gradeFor(input.correct ? "correct" : "wrong", input.responseMs);
  const before = p.stage;
  let stage = before;
  if (input.correct) {
    if (stage < SENTENCE_MASTERED) stage = nextSentenceStage(stage, input.hasReply);
  } else {
    stage = before >= SENTENCE_MASTERED ? 2 : Math.max(0, before - 1);
  }
  const mastered = before >= SENTENCE_MASTERED;
  let sched = schedule({ ...p }, mastered ? MAX_STAGE : 1, grade, now);
  if (stage === SENTENCE_MASTERED && !mastered) {
    sched = { ...sched, reps: 0, intervalDays: 1, dueAt: dueDate(now, 1).toISOString() };
  }
  const day = dayCounters(p, opts.today);
  return {
    ...p,
    ...sched,
    ...day,
    dayWrong: day.dayWrong + (input.correct ? 0 : 1),
    dayCorrect: day.dayCorrect + (input.correct ? 1 : 0),
    stage,
    correctStreak: input.correct ? p.correctStreak + 1 : 0,
    lastReviewedAt: now.toISOString(),
    modeStats: bumpStats(p.modeStats, input.type, input.correct),
  };
}

/** Same daily rules as words: reviews need one correct answer; others may climb `stepsPerDay` steps; 3 mistakes end the day. */
export function sentenceDoneToday(p: Progress, review: boolean, today: string, stepsPerDay: number): boolean {
  return doneToday(p, review ? "sentence_review" : "sentence", today, stepsPerDay);
}

export const isSentenceReview = (s: StudySentence) => s.progress.stage >= SENTENCE_MASTERED;

/** Sentences for today: due reviews, then sentences in progress, then new unlocked ones (deck order); at most `limit`. */
export function planSentences(
  sentences: StudySentence[],
  opts: { now: Date; today: string; stepsPerDay: number; limit: number },
): StudySentence[] {
  const open = sentences.filter((s) => s.unlocked);
  const reviews = open.filter((s) => isSentenceReview(s) && isDue(s.progress.dueAt, opts.now));
  const learning = open.filter(
    (s) => s.progress.stage > 0 && s.progress.stage < SENTENCE_MASTERED && !sentenceDoneToday(s.progress, false, opts.today, opts.stepsPerDay),
  );
  const fresh = open.filter((s) => s.progress.stage === 0 && !sentenceDoneToday(s.progress, false, opts.today, opts.stepsPerDay));
  return [...reviews, ...learning, ...fresh].slice(0, Math.max(0, opts.limit));
}

export const NEW_SENTENCE_PROGRESS: Progress = { ...NEW_PROGRESS };

/* ------------------------------------------------------------------ */
/* Exercises                                                          */
/* ------------------------------------------------------------------ */

let counter = 0;
const key = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Split into chunks for the word-order puzzle (single words; pairs for long sentences). */
export function orderChunks(text: string): string[] {
  const words = text.trim().replace(/[.!?…。]+$/u, "").split(/\s+/).filter(Boolean);
  if (words.length <= 8) return words;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 2) chunks.push(words.slice(i, i + 2).join(" "));
  return chunks;
}

/** Does the learner's order produce the sentence? (Case and punctuation-insensitive, so equal chunks may swap.) */
export function orderCorrect(given: string[], solution: string[]): boolean {
  const n = (xs: string[]) => normWord(xs.join(" ")).replace(/[^\p{L}\p{N}' ]+/gu, "").replace(/\s+/g, " ").trim();
  return n(given) === n(solution);
}

export function buildSentenceQuestion(
  s: StudySentence,
  type: SentenceType,
  ctx: { cards: { id: string; term: string; termLang: string }[]; peers: StudySentence[]; rand: Rand },
): SentenceQuestion {
  const q: SentenceQuestion = { key: key(), sentenceId: s.id, type };
  if (type === "fill_blank") {
    const deckCards = ctx.cards.filter((c) => s.cardIds.includes(c.id));
    let source = s.text;
    let linked = linkWords(source, deckCards, s.termLang);
    // A question whose deck words are all in the reply ("Wie geht's dir?" → "Mir geht's gut."): blank the reply.
    if (linked.length === 0 && s.reply && linkWords(s.reply, deckCards, s.termLang).length) {
      source = s.reply;
      linked = linkWords(source, deckCards, s.termLang);
      q.context = s.text;
      q.blankTranslation = s.replyTranslation ?? undefined;
    }
    const tokens = tokenize(source);
    // Blank a linked deck word (pick randomly), or the longest word if none is linked.
    const pick = linked.length
      ? linked[Math.floor(ctx.rand() * linked.length)]
      : { tokenIndex: tokens.reduce((best, t, i) => (t.raw.length > tokens[best].raw.length ? i : best), 0), length: 1, cardId: "" };
    const first = tokens[pick.tokenIndex];
    const last = tokens[pick.tokenIndex + pick.length - 1];
    const answer = source.slice(first.start, last.end);
    q.blanked = `${source.slice(0, first.start)}___${source.slice(last.end)}`;
    q.answer = answer;
    const pool = Array.from(
      new Set(
        ctx.cards
          .filter((c) => c.id !== pick.cardId)
          .map((c) => {
            const w = termWords(c.term, s.termLang);
            return w.length ? c.term.trim().split(/\s+/).slice(-w.length).join(" ") : c.term;
          })
          .filter((w) => normWord(w) !== normWord(answer)),
      ),
    );
    const distractors = shuffle(pool, ctx.rand)
      .sort((a, b) => Math.abs(a.length - answer.length) - Math.abs(b.length - answer.length))
      .slice(0, 2);
    q.options = shuffle([answer, ...distractors], ctx.rand);
  } else if (type === "word_order") {
    q.solution = orderChunks(s.text);
    let chunks = shuffle(q.solution, ctx.rand);
    for (let i = 0; i < 5 && orderCorrect(chunks, q.solution) && q.solution.length > 1; i++) chunks = shuffle(q.solution, ctx.rand);
    q.chunks = chunks;
  } else if (type === "qa_match") {
    const others = shuffle(
      ctx.peers.filter((p) => p.id !== s.id && p.reply),
      ctx.rand,
    ).slice(0, 3);
    q.pairs = [s, ...others].map((p) => ({ id: p.id, question: p.text, answer: p.reply ?? "" }));
    if (others.length === 0) {
      // Only one pair: matching 1 to 1 is no challenge, so pick the right reply among other sentences instead.
      // Prefer other questions as wrong choices: a statement might also be a valid reply.
      const isQuestion = (t: string) => /[?¿؟]\s*$/u.test(t) ? 0 : 1;
      const wrong = shuffle(
        Array.from(new Set(ctx.peers.filter((p) => p.id !== s.id).flatMap((p) => [p.text, p.reply ?? ""]))).filter(
          (t) => t && normWord(t) !== normWord(s.reply ?? ""),
        ),
        ctx.rand,
      )
        .sort((a, b) => isQuestion(a) - isQuestion(b))
        .slice(0, 2);
      q.options = shuffle([s.reply ?? "", ...wrong], ctx.rand);
      q.answer = s.reply ?? "";
    }
  }
  return q;
}
