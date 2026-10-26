import { NextResponse } from "next/server";
import { parseJson, route } from "@/lib/api";
import { authenticate, publicUser, setSessionCookie } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  const { username, password } = await parseJson(req, loginSchema);
  const user = await authenticate(username, password);
  return setSessionCookie(NextResponse.json({ user: publicUser(user) }), user);
});
