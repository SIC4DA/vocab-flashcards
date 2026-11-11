/**
 * Articles & plurals (pure, shared by client and server).
 * Only languages whose nouns show their gender through the definite article take part (see `gender` in languages.ts).
 */
import { genderArticles } from "./languages";

const lc = (lang: string) => lang.split("-")[0].toLowerCase();
const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ");

/** "der Hund" → { article: "der", noun: "Hund" }; "l'arbre" → { article: "l'", noun: "arbre" }. */
export function splitArticle(term: string, lang: string): { article: string | null; noun: string } {
  const t = norm(term);
  const lower = t.toLowerCase();
  for (const art of genderArticles(lang)) {
    if (art.endsWith("'")) {
      if (lower.startsWith(art) && t.length > art.length) return { article: art, noun: t.slice(art.length).trim() };
      // Typographic apostrophe: l’arbre
      const curly = art.replace("'", "’");
      if (lower.startsWith(curly) && t.length > art.length) return { article: art, noun: t.slice(art.length).trim() };
    } else if (lower.startsWith(`${art} `) && t.length > art.length + 1) {
      return { article: art, noun: t.slice(art.length + 1).trim() };
    }
  }
  return { article: null, noun: t };
}

/** Plural articles to strip from a typed/imported plural ("die Bücher" → "Bücher"). */
const PLURAL_ARTICLES: Record<string, string[]> = {
  de: ["die"],
  es: ["los", "las"],
  fr: ["les"],
  it: ["i", "gli", "le"],
  pt: ["os", "as"],
};

export function stripPluralArticle(plural: string, lang: string): string {
  const p = norm(plural);
  for (const art of PLURAL_ARTICLES[lc(lang)] ?? []) {
    if (p.toLowerCase().startsWith(`${art} `)) return p.slice(art.length + 1).trim();
  }
  return p;
}

/** "das Buch, die Bücher" (import) → term "das Buch", plural "Bücher". */
export function splitTermPlural(term: string, lang: string): { term: string; plural: string | null } {
  if (genderArticles(lang).length === 0) return { term, plural: null };
  const m = term.match(/^(.+?),\s*(.+)$/);
  if (!m) return { term, plural: null };
  const first = splitArticle(m[1], lang);
  const second = m[2].trim();
  // Only when the first part is "article + one noun" and the second looks like a plural of it.
  if (!first.article || first.noun.includes(" ") || second.split(" ").length > 2) return { term, plural: null };
  const plural = stripPluralArticle(second, lang);
  if (!plural || plural.includes(",")) return { term, plural: null };
  return { term: norm(m[1]), plural };
}

export type GrammarCard = { id: string; term: string; definition: string; article: string | null; plural: string | null };

/** Article shown for a card: the stored one, else the one written in front of the term. */
export function cardArticle(c: Pick<GrammarCard, "term" | "article">, lang: string): string | null {
  return c.article ?? splitArticle(c.term, lang).article;
}

export function nounOf(term: string, lang: string): string {
  return splitArticle(term, lang).noun;
}

/** A plural of "-" or "—" means the noun has no plural form. */
export const NO_PLURAL = "—";
export const hasPlural = (p: string | null | undefined) => Boolean(p && p.trim() && p.trim() !== NO_PLURAL && p.trim() !== "-");

/* ------------------------------- checking ------------------------------- */

/** Plural answers are strict about letters (ä ≠ a, ß ≠ ss) but forgive case, extra spaces and a leading plural article. */
export function checkPlural(given: string, expected: string, lang: string): boolean {
  const g = stripPluralArticle(norm(given), lang).toLowerCase();
  const e = stripPluralArticle(norm(expected), lang).toLowerCase();
  return g.length > 0 && g === e;
}

/* ----------------------------- distractors ------------------------------ */

const UMLAUT: Record<string, string> = { a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" };

/** Add an umlaut to the last a/o/u (au → äu) of a German noun: Buch → Büch, Haus → Häus. */
export function umlaut(noun: string): string {
  const au = noun.lastIndexOf("au");
  const idx = Math.max(...["a", "o", "u", "A", "O", "U"].map((v) => noun.lastIndexOf(v)));
  if (au >= 0 && au >= idx - 1) return `${noun.slice(0, au)}äu${noun.slice(au + 2)}`;
  if (idx < 0) return noun;
  return `${noun.slice(0, idx)}${UMLAUT[noun[idx]]}${noun.slice(idx + 1)}`;
}

/** Plausible plural forms built from the usual endings of the language. */
export function pluralCandidates(noun: string, lang: string): string[] {
  const n = noun;
  switch (lc(lang)) {
    case "de": {
      const stem = n.endsWith("e") ? n.slice(0, -1) : n;
      const u = umlaut(n);
      const out = [n, `${n}e`, `${stem}en`, `${n}er`, `${n}s`, u, `${u}e`, `${umlaut(stem)}er`];
      if (/(e|el|er)$/.test(n)) out.push(`${n}n`);
      return out;
    }
    case "es":
      return [`${n}s`, `${n}es`, n.endsWith("z") ? `${n.slice(0, -1)}ces` : `${n}z`, n];
    case "fr":
      return [`${n}s`, `${n}x`, n.endsWith("al") ? `${n.slice(0, -2)}aux` : `${n}aux`, n, `${n}es`];
    case "it": {
      const stem = /[aeio]$/.test(n) ? n.slice(0, -1) : n;
      return [`${stem}i`, `${stem}e`, `${stem}a`, n, `${stem}hi`];
    }
    case "pt": {
      const stem = n.endsWith("ão") ? n.slice(0, -2) : n;
      return [`${n}s`, `${n}es`, `${stem}ões`, `${stem}ães`, n.endsWith("l") ? `${n.slice(0, -1)}is` : `${n}is`, n];
    }
    default:
      return [`${n}s`, `${n}es`, n];
  }
}

export function pluralOptions(noun: string, plural: string, lang: string, rand: () => number = Math.random): string[] {
  const seen = new Set([plural.toLowerCase()]);
  const wrong: string[] = [];
  for (const c of shuffle(pluralCandidates(noun, lang), rand)) {
    if (c && !seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      wrong.push(c);
    }
    if (wrong.length === 3) break;
  }
  return shuffle([plural, ...wrong], rand);
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* --------------------------------- tips --------------------------------- */

type Rule = { re: RegExp; tip: string };

const ARTICLE_RULES: Record<string, Rule[]> = {
  de: [
    { re: /(ung|heit|keit|schaft|tion|sion|tät|ik|ei|ie|ur|enz|anz)$/i, tip: "Nouns ending in -ung, -heit, -keit, -schaft, -ion, -tät, -ik, -ei, -ie are almost always die." },
    { re: /(chen|lein)$/i, tip: "Nouns ending in -chen and -lein (little things) are always das." },
    { re: /(ment|um|tum|nis)$/i, tip: "Nouns ending in -ment, -um and -tum are usually das." },
    { re: /(ling|ismus|or|ig|ich|ant|ist|eur)$/i, tip: "Nouns ending in -ling, -ismus, -or, -ig, -ich, -ist, -eur are usually der." },
    { re: /e$/i, tip: "Most nouns ending in -e are die (but watch out: der Junge, das Auge)." },
    { re: /^ge/i, tip: "Many nouns starting with Ge- are das (das Gemüse, das Gebäude)." },
  ],
  es: [
    { re: /(ción|sión|dad|tad|tud|umbre)$/i, tip: "Nouns ending in -ción, -sión, -dad, -tad, -tud are la." },
    { re: /(ma)$/i, tip: "Many nouns ending in -ma come from Greek and are el (el problema, el tema)." },
    { re: /o$/i, tip: "Nouns ending in -o are usually el (exceptions: la mano, la foto, la moto)." },
    { re: /a$/i, tip: "Nouns ending in -a are usually la (exceptions: el día, el mapa)." },
  ],
  fr: [
    { re: /^[aeiouhéèêàâîôûœ]/i, tip: "Before a vowel or silent h, le and la both become l’." },
    { re: /(tion|sion|té|ette|ence|ance|ure|ise)$/i, tip: "Nouns ending in -tion, -sion, -té, -ette, -ence, -ance are usually la." },
    { re: /(ment|age|eau|isme|oir|et)$/i, tip: "Nouns ending in -ment, -age, -eau, -isme, -oir are usually le (exceptions: la plage, la page)." },
  ],
  it: [
    { re: /^[aeiou]/i, tip: "Before a vowel, il and la both become l’." },
    { re: /^(s[bcdfgklmnpqrstvz]|z|gn|ps|x|y)/i, tip: "Masculine nouns starting with s + consonant, z, gn or ps take lo (lo studente, lo zaino)." },
    { re: /(zione|sione|tà|tù)$/i, tip: "Nouns ending in -zione, -sione, -tà are feminine: la." },
    { re: /o$/i, tip: "Nouns ending in -o are usually masculine: il (or lo)." },
    { re: /a$/i, tip: "Nouns ending in -a are usually feminine: la (exceptions: il problema, il tema)." },
  ],
  pt: [
    { re: /(ção|são|dade|agem|ice)$/i, tip: "Nouns ending in -ção, -são, -dade, -agem are a." },
    { re: /(ma)$/i, tip: "Many nouns ending in -ma are o (o problema, o sistema)." },
    { re: /o$/i, tip: "Nouns ending in -o are usually o." },
    { re: /a$/i, tip: "Nouns ending in -a are usually a (exceptions: o dia, o mapa)." },
  ],
};

const PLURAL_RULES: Record<string, Rule[]> = {
  de: [
    { re: /(ung|heit|keit|schaft|tion|tät|ei|in)$/i, tip: "Feminine endings like -ung, -heit, -keit, -ion, -tät add -en (-in → -innen)." },
    { re: /(chen|lein)$/i, tip: "-chen and -lein nouns don't change in the plural (das Mädchen → die Mädchen)." },
    { re: /(er|el|en)$/i, tip: "Masculine and neuter nouns ending in -er, -el, -en often stay the same, sometimes with an umlaut (der Vater → die Väter)." },
    { re: /e$/i, tip: "Nouns ending in -e usually add -n (die Lampe → die Lampen)." },
    { re: /[aiouy]$/i, tip: "Nouns ending in a vowel other than -e (and many loanwords) add -s (das Auto → die Autos)." },
    { re: /./, tip: "Short masculine nouns often add -e, many with an umlaut; short neuter nouns often add -er with an umlaut (das Buch → die Bücher)." },
  ],
  es: [
    { re: /z$/i, tip: "Nouns ending in -z change to -ces (el lápiz → los lápices)." },
    { re: /[aeiouáéó]$/i, tip: "Nouns ending in a vowel add -s." },
    { re: /./, tip: "Nouns ending in a consonant add -es (el árbol → los árboles)." },
  ],
  fr: [
    { re: /(eau|eu|au)$/i, tip: "Nouns ending in -eau, -eu, -au add -x (le gâteau → les gâteaux)." },
    { re: /al$/i, tip: "Nouns ending in -al usually become -aux (le journal → les journaux)." },
    { re: /[sxz]$/i, tip: "Nouns already ending in -s, -x or -z don't change." },
    { re: /./, tip: "Most nouns just add -s (silent)." },
  ],
  it: [
    { re: /o$/i, tip: "Nouns ending in -o change to -i (il libro → i libri)." },
    { re: /a$/i, tip: "Feminine nouns ending in -a change to -e (la casa → le case)." },
    { re: /e$/i, tip: "Nouns ending in -e change to -i (il fiore → i fiori)." },
    { re: /./, tip: "Nouns ending in a consonant or an accented vowel don't change (il film → i film, la città → le città)." },
  ],
  pt: [
    { re: /ão$/i, tip: "Nouns ending in -ão usually become -ões (sometimes -ães or -ãos)." },
    { re: /m$/i, tip: "Nouns ending in -m change to -ns (o homem → os homens)." },
    { re: /l$/i, tip: "Nouns ending in -l usually change to -is (o animal → os animais)." },
    { re: /[rsz]$/i, tip: "Nouns ending in -r, -s or -z usually add -es." },
    { re: /./, tip: "Nouns ending in a vowel add -s." },
  ],
};

export function articleTip(noun: string, lang: string): string | null {
  return ARTICLE_RULES[lc(lang)]?.find((r) => r.re.test(noun))?.tip ?? null;
}

export function pluralTip(noun: string, lang: string): string | null {
  return PLURAL_RULES[lc(lang)]?.find((r) => r.re.test(noun))?.tip ?? null;
}

/* --------------------------------- game --------------------------------- */

export type GrammarQuestion =
  | { key: string; cardId: string; kind: "article"; noun: string; answer: string; options: string[] }
  | { key: string; cardId: string; kind: "plural_mc"; noun: string; article: string | null; answer: string; options: string[] }
  | { key: string; cardId: string; kind: "plural_write"; noun: string; article: string | null; answer: string };

/**
 * One round: for each noun, pick its article, then its plural (multiple choice the first time,
 * typed when the noun is already known — `known` = ids answered right before).
 */
export function buildGrammarRound(
  cards: GrammarCard[],
  lang: string,
  opts: { size?: number; known?: Set<string>; rand?: () => number } = {},
): GrammarQuestion[] {
  const rand = opts.rand ?? Math.random;
  const arts = genderArticles(lang);
  const playable = cards.filter((c) => cardArticle(c, lang) || hasPlural(c.plural));
  const picked = shuffle(playable, rand).slice(0, opts.size ?? 10);
  const out: GrammarQuestion[] = [];
  for (const c of picked) {
    const noun = nounOf(c.term, lang);
    const article = cardArticle(c, lang);
    if (article && arts.includes(article)) {
      out.push({ key: `${c.id}:a`, cardId: c.id, kind: "article", noun, answer: article, options: arts });
    }
    if (hasPlural(c.plural)) {
      const plural = c.plural!.trim();
      out.push(
        opts.known?.has(c.id)
          ? { key: `${c.id}:pw`, cardId: c.id, kind: "plural_write", noun, article, answer: plural }
          : { key: `${c.id}:pm`, cardId: c.id, kind: "plural_mc", noun, article, answer: plural, options: pluralOptions(noun, plural, lang, rand) },
      );
    }
  }
  return out;
}

/** The article in front of the plural (der Hund → die Hunde, el perro → los perros); null when it can't be told. */
export function pluralArticle(article: string | null, lang: string): string | null {
  switch (lc(lang)) {
    case "de":
      return "die";
    case "fr":
      return "les";
    case "es":
      return article === "el" ? "los" : article === "la" ? "las" : null;
    case "pt":
      return article === "o" ? "os" : article === "a" ? "as" : null;
    case "it":
      return article === "il" ? "i" : article === "lo" ? "gli" : article === "la" ? "le" : null;
    default:
      return null;
  }
}

/** "das Buch → die Bücher" */
export function fullForms(noun: string, article: string | null, plural: string | null, lang: string): string {
  const sg = article ? (article.endsWith("'") ? `${article}${noun}` : `${article} ${noun}`) : noun;
  if (!hasPlural(plural)) return plural ? `${sg} (no plural)` : sg;
  const pa = pluralArticle(article, lang);
  return `${sg} → ${pa ? `${pa} ` : ""}${plural!.trim()}`;
}
