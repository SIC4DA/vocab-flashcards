/**
 * Picks the best pronunciation file for a word from Wiktionary/Commons file names (pure).
 * Naming conventions on Commons:
 *   "De-Hund.ogg", "De-Hund2.ogg", "De-at-Hund.ogg"  (language[-region]-word[n])
 *   "LL-Q188 (deu)-Speaker-Hund.wav"                  (Lingua Libre)
 */

const ISO3: Record<string, string[]> = {
  de: ["deu", "ger"],
  es: ["spa"],
  fr: ["fra", "fre"],
  en: ["eng"],
  it: ["ita"],
  pt: ["por"],
  nl: ["nld", "dut"],
  sv: ["swe"],
  nb: ["nob", "nor"],
  da: ["dan"],
  fi: ["fin"],
  pl: ["pol"],
  cs: ["ces", "cze"],
  ro: ["ron", "rum"],
  hu: ["hun"],
  el: ["ell", "gre"],
  tr: ["tur"],
  ru: ["rus"],
  uk: ["ukr"],
  ar: ["ara", "arb"],
  he: ["heb"],
  fa: ["fas", "pes"],
  hi: ["hin"],
  id: ["ind"],
  vi: ["vie"],
  th: ["tha"],
  zh: ["zho", "cmn"],
  ja: ["jpn"],
  ko: ["kor"],
};

export const AUDIO_EXT = /\.(ogg|oga|opus|wav|mp3|flac)$/i;

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();

/** Score 0 means "not a recording of this word in this language". Higher is better. */
export function scoreRecordingFile(title: string, word: string, lang: string): number {
  if (!AUDIO_EXT.test(title)) return 0;
  const name = norm(title.replace(/^[^:]+:/, "").replace(AUDIO_EXT, ""));
  const w = norm(word);
  if (!w) return 0;
  const [lc, regionRaw] = lang.toLowerCase().split("-");
  const region = regionRaw ?? "";

  if (name === `${lc}-${w}`) return 100;
  const numbered = new RegExp(`^${escape(lc)}-${escape(w)}\\d{1,2}$`);
  if (numbered.test(name)) return 90;
  const regional = new RegExp(`^${escape(lc)}-([a-z]{2,4}(?:-[a-z]{2,4})?)-${escape(w)}\\d{0,2}$`);
  const rm = regional.exec(name);
  if (rm) return rm[1] === region ? 95 : 80;
  const ll = /^ll-q\d+ \(([a-z]{3})\)-.+-(.+)$/.exec(name);
  if (ll && (ISO3[lc] ?? []).includes(ll[1]) && norm(ll[2]) === w) return 85;
  return 0;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Title variants to look up (Wiktionary titles are case-sensitive; German nouns are capitalised). */
export function titleVariants(word: string): string[] {
  const w = word.trim();
  const lower = w.toLocaleLowerCase();
  const cap = lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
  return Array.from(new Set([w, lower, cap]));
}
