import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { zodFieldErrors, type FieldErrors } from "./validation";
import { ConfigError, isProd } from "./env";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: FieldErrors,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new ApiError(404, "not_found", what);
export const unauthorized = () => new ApiError(401, "unauthorized", "Please log in");

export function errorResponse(status: number, code: string, message: string, fields?: FieldErrors) {
  return NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler: maps ApiError/ZodError to the JSON error format, hides internals. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message, err.fields);
      if (err instanceof ConfigError) {
        console.error(err.message);
        return errorResponse(500, "config_error", isProd() ? "Server misconfigured" : err.message);
      }
      console.error("Unhandled API error:", err instanceof Error ? err.message : err);
      return errorResponse(500, "internal_error", "Something went wrong. Please try again.");
    }
  };
}

export async function parseJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
  return validate(schema, body);
}

export function validate<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = zodFieldErrors(result.error);
    const first = Object.values(fields)[0] ?? "Invalid input";
    throw new ApiError(400, "validation_error", first, fields);
  }
  return result.data;
}

export type AuthUser = typeof schema.users.$inferSelect;

/** Resolve the logged-in user from the session cookie, or throw 401. */
export async function requireUser(req: NextRequest): Promise<AuthUser> {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw unauthorized();
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.sub)).limit(1);
  if (!user) throw unauthorized();
  return user;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(id: string) {
  if (!UUID_RE.test(id)) throw notFound();
}

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);
