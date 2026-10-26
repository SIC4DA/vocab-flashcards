import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ApiError, parseJson, requireUser, route } from "@/lib/api";
import { clearSessionCookie, verifyPassword } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";
import { deleteAccountSchema } from "@/lib/validation";

export const runtime = "nodejs";

export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const { password } = await parseJson(req, deleteAccountSchema);
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(400, "invalid_password", "Password is incorrect", { password: "Password is incorrect" });
  }
  const db = await getDb();
  await db.delete(schema.users).where(eq(schema.users.id, user.id));
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
