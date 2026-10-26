import { NextResponse } from "next/server";
import { ApiError, parseJson, route } from "@/lib/api";
import { createUser, publicUser, setSessionCookie } from "@/lib/auth";
import { signupsAllowed } from "@/lib/env";
import { registerSchema } from "@/lib/validation";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  if (!signupsAllowed()) throw new ApiError(403, "signups_disabled", "Sign-ups are disabled on this server");
  const { username, password } = await parseJson(req, registerSchema);
  const user = await createUser(username, password);
  const res = NextResponse.json({ user: publicUser(user) }, { status: 201 });
  return setSessionCookie(res, user);
});
