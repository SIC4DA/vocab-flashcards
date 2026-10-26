import { NextResponse, type NextRequest } from "next/server";
import { createSessionToken, needsRefresh, SESSION_COOKIE, sessionCookieOptions, verifySessionToken } from "./lib/session";

const PUBLIC_PAGES = new Set(["/", "/login", "/register", "/help"]);
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/register", "/api/auth/logout", "/api/health", "/api/config"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** CSRF defence for state-changing API calls: same-origin + JSON/multipart only. */
function csrfCheck(req: NextRequest): NextResponse | null {
  if (!UNSAFE_METHODS.has(req.method)) return null;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) return jsonError(403, "bad_origin", "Cross-origin request blocked");
  } else if (req.headers.get("sec-fetch-site") === "cross-site") {
    return jsonError(403, "bad_origin", "Cross-origin request blocked");
  }
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const hasBody = req.method !== "DELETE" || Number(req.headers.get("content-length") ?? 0) > 0 || type !== "";
  if (hasBody && !type.startsWith("application/json") && !type.startsWith("multipart/form-data")) {
    return jsonError(415, "unsupported_media_type", "Use application/json or multipart/form-data");
  }
  return null;
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi) {
    const csrf = csrfCheck(req);
    if (csrf) return csrf;
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (isApi) {
      if (PUBLIC_API.has(pathname)) return NextResponse.next();
      return jsonError(401, "unauthorized", "Please log in");
    }
    if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (!isApi && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const res = NextResponse.next();
  if (needsRefresh(session) && pathname !== "/api/auth/logout") {
    res.cookies.set(
      SESSION_COOKIE,
      await createSessionToken({ id: session.sub, username: session.username }),
      sessionCookieOptions(),
    );
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)"],
};
