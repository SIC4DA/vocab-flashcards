/** Signed session JWT (HS256) stored in an HTTP-only cookie. */
import { SignJWT, jwtVerify } from "jose";
import { getSessionSecret, isProd } from "./env";

export const SESSION_COOKIE = "vf_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type SessionPayload = { sub: string; username: string; iat: number; exp: number };

export async function createSessionToken(user: { id: string; username: string }): Promise<string> {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const secret = getSessionSecret(); // throws a clear ConfigError when misconfigured
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number" || typeof payload.iat !== "number") {
      return null;
    }
    return { sub: payload.sub, username: String(payload.username ?? ""), iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

/** True when more than half of the session lifetime has elapsed. */
export function needsRefresh(session: SessionPayload, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return nowSec - session.iat > SESSION_TTL_SECONDS / 2;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
