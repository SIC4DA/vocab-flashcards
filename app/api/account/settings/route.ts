import { eq } from "drizzle-orm";
import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { resolveSettings, settingsPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export const PATCH = route(async (req) => {
  const user = await requireUser(req);
  const patch = await parseJson(req, settingsPatchSchema);
  const settings = resolveSettings({ ...resolveSettings(user.settings), ...patch });
  const db = await getDb();
  await db.update(schema.users).set({ settings }).where(eq(schema.users.id, user.id));
  return ok({ settings });
});
