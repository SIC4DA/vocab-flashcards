import "server-only";

export const USER_AGENT = "VocabFlashcards/1.0 (personal vocabulary app; https://github.com/)";

/** fetch with a hard timeout (default 8 s). */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}
