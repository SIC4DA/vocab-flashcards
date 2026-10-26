import "server-only";
import bcrypt from "bcryptjs";
import { and, count, eq, gte, lt } from "drizzle-orm";
import type { NextResponse } from "next/server";
import { getDb, schema } from "./db/client";
import { ApiError } from "./api";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "./session";
import { DEFAULT_SETTINGS } from "./validation";

export const BCRYPT_COST = 11;
export const LOCKOUT_MAX_FAILURES = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

// Used to keep timing similar when the user doesn't exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("timing-equalizer-password"));

export async function createUser(username: string, password: string) {
  const db = await getDb();
  const normalized = normalizeUsername(username);
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.usernameNormalized, normalized))
    .limit(1);
  if (existing.length) {
    throw new ApiError(409, "username_taken", "That username is already taken", {
      username: "That username is already taken",
    });
  }
  const passwordHash = await hashPassword(password);
  try {
    const [user] = await db
      .insert(schema.users)
      .values({ username: username.trim(), usernameNormalized: normalized, passwordHash, settings: DEFAULT_SETTINGS })
      .returning();
    return user;
  } catch {
    // Unique index race
    throw new ApiError(409, "username_taken", "That username is already taken", {
      username: "That username is already taken",
    });
  }
}

export async function isLockedOut(normalized: string, now = new Date()): Promise<boolean> {
  const db = await getDb();
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const [row] = await db
    .select({ n: count() })
    .from(schema.loginAttempts)
    .where(
      and(
        eq(schema.loginAttempts.usernameNormalized, normalized),
        eq(schema.loginAttempts.success, false),
        gte(schema.loginAttempts.attemptedAt, since),
      ),
    );
  return Number(row?.n ?? 0) >= LOCKOUT_MAX_FAILURES;
}

async function recordAttempt(normalized: string, success: boolean) {
  const db = await getDb();
  await db.insert(schema.loginAttempts).values({ usernameNormalized: normalized, success });
  // Opportunistic cleanup of old rows
  if (Math.random() < 0.05) {
    await db
      .delete(schema.loginAttempts)
      .where(lt(schema.loginAttempts.attemptedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  }
}

export async function authenticate(username: string, password: string) {
  const normalized = normalizeUsername(username);
  if (await isLockedOut(normalized)) {
    throw new ApiError(
      429,
      "locked_out",
      "Too many failed attempts. Please wait 15 minutes and try again.",
    );
  }
  const db = await getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.usernameNormalized, normalized))
    .limit(1);
  const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid) {
    await recordAttempt(normalized, false);
    throw new ApiError(401, "invalid_credentials", "Invalid username or password");
  }
  await recordAttempt(normalized, true);
  return user;
}

export async function setSessionCookie(res: NextResponse, user: { id: string; username: string }) {
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions());
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}

export function publicUser(user: { id: string; username: string; settings: unknown }) {
  return { id: user.id, username: user.username };
}
