import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { fetchWithTimeout } from "./http";
import { getLanguage } from "./languages";
import { AUDIO_EXT, scoreRecordingFile, titleVariants } from "./recording-match";

export type Recording = { url: string | null; attribution: string | null; prefix: string | null };

const NONE: Recording = { url: null, attribution: null, prefix: null };
const NEGATIVE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function wiktionaryApi(lc: string): string {
  const override = process.env.WIKTIONARY_API_URL;
  return override ? `${override}/w/api.php` : `https://${lc}.wiktionary.org/w/api.php`;
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

type Page = {
  title: string;
  videoinfo?: {
    url?: string;
    derivatives?: { src: string; type: string }[];
    extmetadata?: Record<string, { value?: string }>;
  }[];
};

/** Candidate words: the full term, and the term without a leading article ("der Hund" → "Hund"). */
export function lookupCandidates(text: string, lang: string): { word: string; prefix: string | null }[] {
  const term = text.trim().replace(/[.!?…]+$/u, "").replace(/\s+/g, " ");
  const out = [{ word: term, prefix: null as string | null }];
  for (const art of getLanguage(lang).articles ?? []) {
    if (art.endsWith("'")) {
      if (term.toLowerCase().startsWith(art) && term.length > art.length) {
        out.push({ word: term.slice(art.length), prefix: term.slice(0, art.length) });
      }
    } else if (term.toLowerCase().startsWith(`${art} `)) {
      out.push({ word: term.slice(art.length + 1), prefix: term.slice(0, art.length) });
    }
  }
  return out;
}

async function searchSite(lc: string, lang: string, candidates: { word: string; prefix: string | null }[]) {
  const titles = Array.from(new Set(candidates.flatMap((c) => titleVariants(c.word)))).slice(0, 12);
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: titles.join("|"),
    generator: "images",
    gimlimit: "100",
    prop: "videoinfo",
    viprop: "url|derivatives|extmetadata",
    redirects: "1",
    origin: "*",
  });
  const res = await fetchWithTimeout(`${wiktionaryApi(lc)}?${params}`, {}, 6000);
  if (!res.ok) throw new Error(`Wiktionary ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: Record<string, Page> } };
  let best: { page: Page; score: number; prefix: string | null } | null = null;
  for (const page of Object.values(data.query?.pages ?? {})) {
    if (!AUDIO_EXT.test(page.title)) continue;
    for (const c of candidates) {
      // The full term beats the article-less one at equal quality.
      const score = scoreRecordingFile(page.title, c.word, lang) - (c.prefix ? 5 : 0);
      if (score > 0 && (!best || score > best.score)) best = { page, score, prefix: c.prefix };
    }
  }
  if (!best) return null;
  const info = best.page.videoinfo?.[0];
  if (!info) return null;
  const mp3 = info.derivatives?.find((d) => d.type.startsWith("audio/mpeg"))?.src;
  const url = mp3 ?? info.url;
  if (!url || !url.startsWith("https://")) return null;
  const meta = info.extmetadata ?? {};
  const artist = meta.Artist?.value ? stripHtml(meta.Artist.value) : "";
  const license = meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : "";
  const attribution = ["Recording", artist && `by ${artist}`, license, "Wikimedia Commons"].filter(Boolean).join(" · ");
  return { url, attribution, prefix: best.prefix };
}

/**
 * Finds a native-speaker recording on the term language's Wiktionary (then English Wiktionary).
 * Results (including "nothing found") are cached in Postgres. Never throws.
 */
export async function findRecording(text: string, lang: string): Promise<Recording> {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 60 || clean.split(" ").length > 4) return NONE;
  const key = `${lang.toLowerCase()}|${clean.toLowerCase()}`;
  const db = await getDb();
  const [cached] = await db.select().from(schema.pronunciations).where(eq(schema.pronunciations.key, key)).limit(1);
  if (cached && (cached.url || Date.now() - new Date(cached.updatedAt).getTime() < NEGATIVE_TTL_MS)) {
    return { url: cached.url, attribution: cached.attribution, prefix: cached.prefix };
  }
  const lc = lang.split("-")[0].toLowerCase();
  const candidates = lookupCandidates(clean, lang);
  let found: Recording | null = null;
  let failed = false;
  for (const site of Array.from(new Set([lc, "en"]))) {
    try {
      found = await searchSite(site, lang, candidates);
      if (found) break;
    } catch (err) {
      failed = true;
      console.warn("Wiktionary lookup failed:", err instanceof Error ? err.message : err);
    }
  }
  const result = found ?? NONE;
  // Don't cache "nothing" when the lookup itself failed (network/rate limit) — try again next time.
  if (found || !failed) {
    await db
      .insert(schema.pronunciations)
      .values({ key, ...result })
      .onConflictDoUpdate({ target: schema.pronunciations.key, set: { ...result, updatedAt: new Date() } });
  }
  return result;
}
