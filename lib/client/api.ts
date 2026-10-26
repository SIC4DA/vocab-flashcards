"use client";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal; form?: FormData };

/** JSON fetch against our own API. Throws ApiClientError with the server's error shape. */
export async function api<T = unknown>(url: string, opts: Options = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"), signal: opts.signal };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined || (init.method && init.method !== "GET")) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiClientError(0, "network_error", "Network error — check your connection and try again.");
  }
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
    const login = new URL("/login", window.location.origin);
    login.searchParams.set("next", window.location.pathname + window.location.search);
    window.location.assign(login);
  }
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiClientError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, e?.fields);
  }
  return data as T;
}

export const tzOffset = () => new Date().getTimezoneOffset();
