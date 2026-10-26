import { ok, requireUser, route } from "@/lib/api";
import { computeStreak, dueSummary, localDay, reviewDays } from "@/lib/data";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const tz = Math.max(-840, Math.min(840, Number(req.nextUrl.searchParams.get("tz") ?? 0) || 0));
  const now = new Date();
  const [due, days] = await Promise.all([dueSummary(user.id, now), reviewDays(user.id, tz)]);
  return ok({ ...due, streak: computeStreak(days, localDay(now, tz)) });
});
