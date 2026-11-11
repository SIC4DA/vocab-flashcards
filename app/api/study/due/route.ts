import { ok, requireUser, route } from "@/lib/api";
import { DAILY_MIN_STAGE, DAILY_SIZE, lastDays } from "@/lib/daily";
import {
  computeStreak,
  dailyCompletedDays,
  dailyPoolCount,
  dailyStatus,
  dueSummary,
  getDailyReview,
  localDay,
} from "@/lib/data";

export const runtime = "nodejs";

/** Dashboard "Today": due counts, today's daily review, the streak and the last 7 days. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const tz = Math.max(-840, Math.min(840, Number(req.nextUrl.searchParams.get("tz") ?? 0) || 0));
  const now = new Date();
  const today = localDay(now, tz);
  const [due, days, row, known] = await Promise.all([
    dueSummary(user.id, now),
    dailyCompletedDays(user.id),
    getDailyReview(user.id, today),
    dailyPoolCount(user.id, DAILY_MIN_STAGE),
  ]);
  const done = new Set(days);
  const status = dailyStatus(row, today);
  return ok({
    ...due,
    streak: computeStreak(days, today),
    week: lastDays(today).map((day) => ({ day, done: done.has(day) })),
    daily: { ...status, total: row ? status.total : Math.min(known, DAILY_SIZE), known },
  });
});
