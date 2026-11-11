import "server-only";
import { fetchWithTimeout } from "./http";
import { genderArticles } from "./languages";
import { wiktionaryApi } from "./pronounce";
import { NO_PLURAL, nounOf } from "./grammar";

export type NounGrammar = { article: string | null; plural: string | null };

const GENUS: Record<string, string> = { m: "der", f: "die", n: "das" };

/** Reads gender and plural from the "Deutsch Substantiv Übersicht" table of a German Wiktionary page. */
export function parseGermanNoun(wikitext: string): NounGrammar | null {
  const start = wikitext.indexOf("{{Deutsch Substantiv Übersicht");
  if (start < 0) return null;
  const end = wikitext.indexOf("}}", start);
  const block = wikitext.slice(start, end < 0 ? undefined : end);
  const field = (name: string) => {
    const m = block.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^|\\n]*)`));
    return m ? m[1].trim() : "";
  };
  const genus = field("Genus") || field("Genus 1");
  const plural = field("Nominativ Plural") || field("Nominativ Plural 1") || field("Nominativ Plural\\*");
  const article = GENUS[genus] ?? null;
  const pl = plural === "—" || plural === "-" ? NO_PLURAL : plural.replace(/\[\[|\]\]/g, "").trim() || null;
  if (!article && !pl) return null;
  return { article, plural: pl };
}

/** German nouns from de.wiktionary.org; null when not found or the lookup fails. Never throws. */
export async function lookupGermanNoun(term: string): Promise<NounGrammar | null> {
  const noun = nounOf(term, "de-DE");
  if (!noun || noun.includes(" ") || noun.length > 40) return null;
  const title = noun[0].toUpperCase() + noun.slice(1);
  const params = new URLSearchParams({
    action: "parse",
    page: title,
    prop: "wikitext",
    format: "json",
    formatversion: "2",
    redirects: "1",
    origin: "*",
  });
  try {
    const res = await fetchWithTimeout(`${wiktionaryApi("de")}?${params}`, {}, 6000);
    if (!res.ok) return null;
    const data = (await res.json()) as { parse?: { wikitext?: string } };
    return data.parse?.wikitext ? parseGermanNoun(data.parse.wikitext) : null;
  } catch {
    return null;
  }
}

/** Keeps only an article the language really has, and a sensible plural. */
export function cleanGrammar(g: { article?: unknown; plural?: unknown }, lang: string): NounGrammar {
  const arts = genderArticles(lang);
  const a = typeof g.article === "string" ? g.article.trim().toLowerCase().replace("’", "'") : "";
  const p = typeof g.plural === "string" ? g.plural.trim() : "";
  return {
    article: arts.includes(a) ? a : null,
    plural: p && p.length <= 60 ? p : null,
  };
}
