import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export const POST = route(async () => clearSessionCookie(NextResponse.json({ ok: true })));
