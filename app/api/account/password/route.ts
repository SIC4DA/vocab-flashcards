import { eq } from "drizzle-orm";
import { ApiError, ok, parseJson, requireUser, route } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";
import { changePasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";

export const PATCH = route(async (req) => {
  const user = await requireUser(req);
  const { currentPassword, newPassword } = await parseJson(req, changePasswordSchema);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ApiError(400, "invalid_password", "Current password is incorrect", {
      currentPassword: "Current password is incorrect",
    });
  }
  const db = await getDb();
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(schema.users.id, user.id));
  return ok({ ok: true });
});
