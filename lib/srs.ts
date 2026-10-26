/**
 * Simplified SM-2 spaced-repetition scheduling. Pure functions only.
 *
 * - Mastered cards (stage 6) follow full SM-2: 1 day, 6 days, then interval × ease.
 * - Cards still on the learning ladder (stages 1–5) get a "light" schedule: ease is
 *   tracked, a correct answer makes the card due again in 1 day, a wrong one makes it
 *   due immediately. `reps` only counts mastered reviews, so graduation starts SM-2 fresh.
 */

export const MIN_EASE = 1.3;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type Grade = 0 | 1 | 2 | 3 | 4 | 5;

export type SrsState = {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
};

export type Outcome = "correct" | "almost" | "wrong";

/** Map an answer outcome (+ response time) to an SM-2 grade. */
export function gradeFor(outcome: Outcome, responseMs?: number): Grade {
  if (outcome === "wrong") return 1;
  if (outcome === "almost") return 3;
  return responseMs !== undefined && responseMs > 0 && responseMs < 5000 ? 5 : 4;
}

export function nextEase(ease: number, grade: Grade): number {
  const q = grade;
  const updated = ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  return Math.max(MIN_EASE, Math.round(updated * 1000) / 1000);
}

/** Full SM-2 step. */
export function sm2(state: SrsState, grade: Grade): SrsState {
  if (grade < 3) {
    return {
      ease: nextEase(state.ease, grade),
      intervalDays: 1,
      reps: 0,
      lapses: state.lapses + 1,
    };
  }
  let intervalDays: number;
  if (state.reps === 0) intervalDays = 1;
  else if (state.reps === 1) intervalDays = 6;
  else intervalDays = Math.round(state.intervalDays * state.ease * 100) / 100;
  return {
    ease: nextEase(state.ease, grade),
    intervalDays,
    reps: state.reps + 1,
    lapses: state.lapses,
  };
}

/** Light schedule for cards that are still being learned (stage 1–5). */
export function learningStep(state: SrsState, grade: Grade): SrsState {
  if (grade < 3) {
    return { ease: nextEase(state.ease, grade), intervalDays: 0, reps: 0, lapses: state.lapses + 1 };
  }
  return { ease: nextEase(state.ease, grade), intervalDays: 1, reps: 0, lapses: state.lapses };
}

export function dueDate(now: Date, intervalDays: number): Date {
  return new Date(now.getTime() + intervalDays * DAY_MS);
}

export function isDue(dueAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() <= now.getTime();
}
