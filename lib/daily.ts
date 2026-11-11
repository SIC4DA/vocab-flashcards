/**
 * Daily review (pure): a light, finite session across all decks with words the user already knows.
 * Finishing it is what keeps the streak going.
 */
import { applyAnswer, bumpStats, isCardDue, type AnswerResult, type Progress, type QuestionType, type StudyCard } from "./learn";

/** Words the daily review draws from: written from memory at least once (stage ≥ 4). */
export const DAILY_MIN_STAGE = 4;
/** ~10 minutes at ~20 s per answer, with a few re-asks. */
export const DAILY_SIZE = 25;
/** "Keep reviewing" batches after the daily review is done. */
export const EXTRA_SIZE = 10;

/** How often the word has been missed: lapses weigh more than single wrong answers. */
export function missScore(p: Progress): number {
  const wrong = Object.values(p.modeStats ?? {}).reduce((s, v) => s + (v?.wrong ?? 0), 0);
  return p.lapses * 2 + wrong;
}

/**
 * Picks the words: due ones first (oldest due first), then the most-missed, then the ones not seen for longest.
 * `exclude` skips words already reviewed today (for "Keep reviewing").
 */
export function planDailyReview(
  cards: StudyCard[],
  now: Date,
  opts: { size?: number; exclude?: Set<string> } = {},
): StudyCard[] {
  const pool = cards.filter((c) => c.progress.stage >= DAILY_MIN_STAGE && !opts.exclude?.has(c.id));
  const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
  const due = pool.filter((c) => isCardDue(c, now)).sort((a, b) => time(a.progress.dueAt) - time(b.progress.dueAt));
  const dueIds = new Set(due.map((c) => c.id));
  const rest = pool
    .filter((c) => !dueIds.has(c.id))
    .sort(
      (a, b) =>
        missScore(b.progress) - missScore(a.progress) || time(a.progress.lastReviewedAt) - time(b.progress.lastReviewedAt),
    );
  return [...due, ...rest].slice(0, opts.size ?? DAILY_SIZE);
}

/**
 * A daily-review answer only touches the schedule when it matters: a due word is reviewed normally,
 * and a missed word drops back (and comes back sooner). A correct answer to a word that isn't due yet
 * only counts in the stats, so reviewing early never pushes a word's next review far into the future.
 */
export function applyDailyAnswer(
  p: Progress,
  input: { correct: boolean; grade?: 0 | 1 | 2 | 3 | 4 | 5; type: QuestionType; responseMs?: number },
  now: Date = new Date(),
): AnswerResult {
  const due = p.stage >= 1 && (!p.dueAt || new Date(p.dueAt).getTime() <= now.getTime());
  if (!input.correct || due) {
    return applyAnswer(p, { ...input, ladder: false }, { advanceAfter: 1 }, now);
  }
  return {
    progress: { ...p, lastReviewedAt: now.toISOString(), modeStats: bumpStats(p.modeStats, input.type, true) },
    previousStage: p.stage,
    stageChanged: 0,
  };
}

/** Days (YYYY-MM-DD) ending today, oldest first: the week strip on the dashboard. */
export function lastDays(today: string, n = 7): string[] {
  const d = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}
