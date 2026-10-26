import { ok, requireUser, route } from "@/lib/api";
import { publicUser } from "@/lib/auth";
import { resolveSettings } from "@/lib/validation";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return ok({ user: publicUser(user), settings: resolveSettings(user.settings) });
});
