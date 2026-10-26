import "server-only";
import { apiBase } from "./env";
import { fetchWithTimeout } from "./http";
import { geminiTranslate } from "./gemini";

export type Translation = { translation: string; example?: string; source: "gemini" | "mymemory" };

export async function myMemoryTranslate(text: string, from: string, to: string): Promise<string> {
  const params = new URLSearchParams({ q: text, langpair: `${from}|${to}` });
  const res = await fetchWithTimeout(`${apiBase.mymemory()}/get?${params}`);
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const data = (await res.json()) as {
    responseStatus?: number | string;
    quotaFinished?: boolean;
    responseData?: { translatedText?: string };
  };
  const out = data.responseData?.translatedText?.trim();
  if (Number(data.responseStatus) !== 200 || data.quotaFinished || !out || /^MYMEMORY WARNING/i.test(out)) {
    throw new Error("MyMemory returned no translation");
  }
  return out;
}

/** Gemini when the user has a key (falls back to MyMemory on failure), otherwise MyMemory. */
export async function suggestTranslation(
  text: string,
  from: string,
  to: string,
  geminiKey: string | null,
): Promise<Translation | null> {
  if (geminiKey) {
    try {
      return { ...(await geminiTranslate(geminiKey, text, from, to)), source: "gemini" };
    } catch (err) {
      console.warn("Gemini translate failed, falling back:", err instanceof Error ? err.message : err);
    }
  }
  try {
    return { translation: await myMemoryTranslate(text, from, to), source: "mymemory" };
  } catch (err) {
    console.warn("MyMemory translate failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
