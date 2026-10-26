import "server-only";
import { apiBase } from "./env";
import { fetchWithTimeout } from "./http";

export type ImageResult = {
  thumbUrl: string;
  url: string;
  width: number | null;
  height: number | null;
  attribution: string;
  mime?: string;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; results: ImageResult[] }>();

const IMAGE_EXT = /^(jpe?g|png|webp|gif)$/i;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isHttps(u: unknown): u is string {
  return typeof u === "string" && u.startsWith("https://");
}

type OpenverseItem = {
  url?: string;
  thumbnail?: string;
  width?: number | null;
  height?: number | null;
  creator?: string | null;
  license?: string;
  license_version?: string;
  foreign_landing_url?: string;
  filetype?: string | null;
  title?: string | null;
};

export async function searchOpenverse(q: string, pageSize = 10): Promise<ImageResult[]> {
  const params = new URLSearchParams({
    q,
    license_type: "all",
    mature: "false",
    page_size: String(pageSize),
  });
  const res = await fetchWithTimeout(`${apiBase.openverse()}/v1/images/?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Openverse ${res.status}`);
  const data = (await res.json()) as { results?: OpenverseItem[] };
  return (data.results ?? [])
    .filter((r) => isHttps(r.thumbnail ?? r.url) && (!r.filetype || IMAGE_EXT.test(r.filetype)))
    .map((r) => {
      const license = r.license ? `CC ${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim() : "";
      const parts = [r.title ? `“${r.title}”` : null, r.creator ? `by ${r.creator}` : null, license || null];
      const source = r.foreign_landing_url ? ` — ${r.foreign_landing_url}` : "";
      return {
        thumbUrl: (isHttps(r.thumbnail) ? r.thumbnail : r.url) as string,
        url: (isHttps(r.url) ? r.url : r.thumbnail) as string,
        width: r.width ?? null,
        height: r.height ?? null,
        attribution: `${parts.filter(Boolean).join(", ")}${source}` || "Openverse",
        mime: r.filetype ? `image/${r.filetype.replace("jpg", "jpeg")}` : undefined,
      };
    });
}

type WikiPage = {
  index?: number;
  title?: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    width?: number;
    height?: number;
    mime?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
};

export async function searchWikimedia(q: string, limit = 10): Promise<ImageResult[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${q} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "400",
    origin: "*",
  });
  const res = await fetchWithTimeout(`${apiBase.wikimedia()}/w/api.php?${params}`);
  if (!res.ok) throw new Error(`Wikimedia ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: ImageResult[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !isHttps(info.thumburl ?? info.url)) continue;
    if (info.mime && !/^image\/(jpeg|png|webp|gif)$/.test(info.mime)) continue;
    const meta = info.extmetadata ?? {};
    const artist = meta.Artist?.value ? stripHtml(meta.Artist.value) : "";
    const license = meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : "";
    const parts = [artist ? `by ${artist}` : null, license || null].filter(Boolean).join(", ");
    out.push({
      thumbUrl: (info.thumburl ?? info.url) as string,
      url: (info.url ?? info.thumburl) as string,
      width: info.width ?? null,
      height: info.height ?? null,
      attribution: `${parts || "Wikimedia Commons"}${info.descriptionurl ? ` — ${info.descriptionurl}` : ""}`,
      mime: info.mime,
    });
  }
  return out;
}

/** Openverse first, Wikimedia Commons as fallback. Never throws; cached per query for 1 h. */
export async function searchImages(query: string, limit = 12): Promise<ImageResult[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const key = `${q.toLowerCase()}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  let results: ImageResult[] = [];
  try {
    results = await searchOpenverse(q, limit);
  } catch (err) {
    console.warn("Openverse search failed:", err instanceof Error ? err.message : err);
  }
  if (results.length === 0) {
    try {
      results = await searchWikimedia(q, limit);
    } catch (err) {
      console.warn("Wikimedia search failed:", err instanceof Error ? err.message : err);
    }
  }
  results = results.slice(0, limit);
  if (results.length) {
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), results });
  }
  return results;
}

/** First result that is an image, roughly landscape or square, and ≥ 200 px when the size is known. */
export function pickBestImage(results: ImageResult[]): ImageResult | null {
  for (const r of results) {
    if (r.mime && !r.mime.startsWith("image/")) continue;
    if (r.width && r.height) {
      if (Math.min(r.width, r.height) < 200) continue;
      if (r.width / r.height < 0.8) continue;
    }
    return r;
  }
  return null;
}
