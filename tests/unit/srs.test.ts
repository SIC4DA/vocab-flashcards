import { describe, expect, it } from "vitest";
import { DAY_MS, dueDate, gradeFor, isDue, learningStep, MIN_EASE, nextEase, sm2, type SrsState } from "@/lib/srs";

const fresh: SrsState = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };

describe("gradeFor", () => {
  it("maps outcomes to SM-2 grades", () => {
    expect(gradeFor("wrong")).toBe(1);
    expect(gradeFor("almost")).toBe(3);
    expect(gradeFor("correct")).toBe(4);
    expect(gradeFor("correct", 6000)).toBe(4);
    expect(gradeFor("correct", 3000)).toBe(5);
  });
});

describe("sm2", () => {
  it("progresses 1 day, 6 days, then interval × ease", () => {
    const a = sm2(fresh, 4);
    expect(a.intervalDays).toBe(1);
    expect(a.reps).toBe(1);
    const b = sm2(a, 4);
    expect(b.intervalDays).toBe(6);
    expect(b.reps).toBe(2);
    const c = sm2(b, 4);
    expect(c.intervalDays).toBeCloseTo(6 * b.ease, 2);
    expect(c.reps).toBe(3);
  });

  it("updates ease per the SM-2 formula", () => {
    expect(nextEase(2.5, 5)).toBeCloseTo(2.6, 5);
    expect(nextEase(2.5, 4)).toBeCloseTo(2.5, 5);
    expect(nextEase(2.5, 3)).toBeCloseTo(2.36, 5);
    expect(nextEase(2.5, 1)).toBeCloseTo(1.96, 5);
  });

  it("never lets ease drop below 1.3", () => {
    let s = fresh;
    for (let i = 0; i < 20; i++) s = sm2(s, 1);
    expect(s.ease).toBe(MIN_EASE);
    expect(nextEase(1.3, 0)).toBe(MIN_EASE);
  });

  it("handles lapses: lapses++, interval 1 day, reps reset", () => {
    const learned = sm2(sm2(sm2(fresh, 5), 5), 5);
    const lapsed = sm2(learned, 1);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.reps).toBe(0);
    // relearning restarts at 1 then 6
    expect(sm2(lapsed, 4).intervalDays).toBe(1);
  });

  it("grade 3 counts as a pass", () => {
    const s = sm2(fresh, 3);
    expect(s.intervalDays).toBe(1);
    expect(s.lapses).toBe(0);
  });
});

describe("learningStep", () => {
  it("correct → due in 1 day, wrong → due now, reps stay 0", () => {
    expect(learningStep(fresh, 4)).toMatchObject({ intervalDays: 1, reps: 0, lapses: 0 });
    expect(learningStep(fresh, 1)).toMatchObject({ intervalDays: 0, reps: 0, lapses: 1 });
  });
});

describe("due date math", () => {
  it("adds the interval in days", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(dueDate(now, 1).toISOString()).toBe("2026-01-02T12:00:00.000Z");
    expect(dueDate(now, 6).getTime() - now.getTime()).toBe(6 * DAY_MS);
    expect(dueDate(now, 0.5).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
  it("isDue compares with now", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isDue("2026-01-01T11:59:59Z", now)).toBe(true);
    expect(isDue("2026-01-01T12:00:00Z", now)).toBe(true);
    expect(isDue("2026-01-01T12:00:01Z", now)).toBe(false);
    expect(isDue(null, now)).toBe(false);
  });
});
