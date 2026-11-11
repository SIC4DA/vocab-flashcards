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

/**
 * Rule-of-thumb tips shown after a mistake. Each rule is narrow on purpose (a tip that's wrong for the word
 * on screen is worse than no tip) and names its common exceptions. Checked against standard grammar
 * references; see tests/unit/grammar-daily.test.ts for the words each rule must and must not match.
 */
type Rule = { re: RegExp; tip: string; article?: string[] };

const ARTICLE_RULES: Record<string, Rule[]> = {
  de: [
    // Diminutives; the consonant before -chen leaves out der Kuchen, der Knochen, der Rachen.
    { re: /([^aeiouäöü]chen|lein)$/i, tip: "Nouns ending in the diminutive -chen or -lein are always das (das Mädchen, das Brötchen)." },
    { re: /(ung|heit|keit|schaft|tion|sion|tät|erei|.{3}enz)$/i, tip: "Nouns ending in -ung, -heit, -keit, -schaft, -tion, -sion, -tät, -erei and -enz are die (die Zeitung, die Freiheit) — only a few short words like der Sprung break the rule." },
    { re: /(ismus|ling)$/i, tip: "Nouns ending in -ismus and -ling are der (der Tourismus, der Frühling)." },
    { re: /^.{3,}(ist|ant|eur)$/i, tip: "People and things ending in -ist, -ant and -eur are usually der (der Polizist, der Elefant, der Friseur) — but das Restaurant." },
    { re: /^.{2,}(or|ig)$/i, tip: "Nouns ending in -or and -ig are usually der (der Motor, der König), with a few exceptions like das Tor." },
    { re: /(ment|[^at]um)$/i, tip: "Nouns ending in -ment and Latin nouns ending in -um are usually das (das Dokument, das Museum) — but der Moment." },
    { re: /^ge/i, tip: "Many nouns starting with Ge- are das (das Gemüse, das Gebäude, das Geld), but not all (die Geschichte, der Geschmack)." },
    { re: /e$/i, tip: "Most nouns ending in -e are die (die Lampe), but not all: der Junge, der Name, das Auge, das Ende." },
  ],
  es: [
    { re: /(ción|sión|dad|tad|tud|umbre)$/i, tip: "Nouns ending in -ción, -sión, -dad, -tad, -tud and -umbre are la (la canción, la ciudad)." },
    { re: /ma$/i, tip: "Words ending in -ma are split: many from Greek are el (el problema, el tema, el sistema), others are la (la cama, la forma)." },
    { re: /o$/i, tip: "Nouns ending in -o are usually el (exceptions: la mano, la foto, la moto, la radio)." },
    { re: /a$/i, tip: "Nouns ending in -a are usually la (exceptions: el día, el mapa, el planeta)." },
  ],
  fr: [
    { re: /^[aeiouyéèêàâîôûœ]/i, tip: "Before a vowel or a silent h, le and la both become l’ (l’arbre, l’école, l’homme)." },
    { re: /(tion|sion|ette|ance|ure)$/i, tip: "Nouns ending in -tion, -sion, -ette, -ance and -ure are usually la (la nation, la voiture)." },
    { re: /(té|ence)$/i, tip: "Nouns ending in -té and -ence are usually la (la liberté, la science), but le côté, le comité and le silence are masculine." },
    { re: /(ment|age|isme|oir)$/i, tip: "Nouns ending in -ment, -age, -isme and -oir are usually le (le moment, le fromage), but la plage, la page and l’image are feminine." },
    { re: /eau$/i, tip: "Nouns ending in -eau are usually le (le bateau, le gâteau), but la peau and l’eau are feminine." },
  ],
  it: [
    { re: /^[aeiouàèéìòù]/i, tip: "Before a vowel, lo and la become l’ (l’amico, l’isola)." },
    { re: /(zione|sione|tà|tù)$/i, tip: "Nouns ending in -zione, -sione, -tà and -tù are feminine: la (la stazione, la città)." },
    { re: /^(s[bcdfgklmnpqrstvz]|z|gn|ps|x|y)/i, tip: "Masculine nouns starting with s + consonant, z, gn, ps, x or y take lo instead of il (lo studente, lo zaino)." },
    { re: /o$/i, tip: "Nouns ending in -o are usually masculine: il (or lo) — exceptions: la mano, la radio, la foto." },
    { re: /a$/i, tip: "Nouns ending in -a are usually feminine: la (exceptions: il problema, il tema, il papà)." },
  ],
  pt: [
    { re: /(ção|são|dade|agem|ice)$/i, tip: "Nouns ending in -ção, -são, -dade, -agem and -ice are a (a canção, a cidade, a viagem)." },
    { re: /ma$/i, tip: "Words ending in -ma are split: many from Greek are o (o problema, o tema, o sistema), others are a (a cama, a forma)." },
    { re: /o$/i, tip: "Nouns ending in -o are usually o (exceptions: a foto, a moto, a tribo)." },
    { re: /a$/i, tip: "Nouns ending in -a are usually a (exceptions: o dia, o mapa, o planeta)." },
  ],
};

const PLURAL_RULES: Record<string, Rule[]> = {
  de: [
    { re: /([^aeiouäöü]chen|lein)$/i, tip: "Diminutives ending in -chen and -lein don't change (das Mädchen → die Mädchen)." },
    { re: /(ung|heit|keit|schaft|tion|sion|tät|erei)$/i, tip: "Nouns ending in -ung, -heit, -keit, -schaft, -ion, -tät and -erei add -en (die Zeitung → die Zeitungen)." },
    { re: /in$/i, article: ["die"], tip: "Female forms ending in -in add -nen (die Lehrerin → die Lehrerinnen)." },
    { re: /e$/i, tip: "Nouns ending in -e usually add -n (die Lampe → die Lampen, der Junge → die Jungen)." },
    { re: /(el|er)$/i, article: ["die"], tip: "Feminine nouns ending in -el and -er add -n (die Regel → die Regeln, die Schwester → die Schwestern); only die Mutter and die Tochter take an umlaut instead (Mütter, Töchter)." },
    { re: /(el|er|en)$/i, article: ["der", "das"], tip: "Masculine and neuter nouns ending in -el, -er and -en usually stay the same, sometimes with an umlaut (der Lehrer → die Lehrer, der Vater → die Väter)." },
    // Not -au/-ei (die Frau → Frauen, das Ei → Eier).
    { re: /(?<![ae])[aiouy]$/i, tip: "Nouns ending in -a, -i, -o, -u or -y, and many loanwords, usually add -s (das Auto → die Autos, das Handy → die Handys)." },
    { re: /./, article: ["der"], tip: "Many masculine nouns add -e, often with an umlaut (der Hund → die Hunde, der Stuhl → die Stühle)." },
    { re: /./, article: ["das"], tip: "Short neuter nouns often add -er with an umlaut (das Buch → die Bücher, das Haus → die Häuser) or just -e (das Jahr → die Jahre)." },
    { re: /./, article: ["die"], tip: "Feminine nouns usually add -en or -n (die Frau → die Frauen); some short ones add -e with an umlaut (die Hand → die Hände)." },
  ],
  es: [
    { re: /z$/i, tip: "Nouns ending in -z change to -ces (el lápiz → los lápices)." },
    { re: /[aeiouáéíóú]$/i, tip: "Nouns ending in a vowel add -s (el libro → los libros)." },
    { re: /s$/i, tip: "Nouns ending in -s add -es when the last syllable is stressed (el mes → los meses) and don't change when it isn't (el lunes → los lunes)." },
    { re: /./, tip: "Nouns ending in a consonant add -es (el árbol → los árboles); a written accent can disappear or appear (la canción → las canciones, el joven → los jóvenes)." },
  ],
  fr: [
    { re: /(eau|eu|au)$/i, tip: "Nouns ending in -eau, -eu and -au add -x (le gâteau → les gâteaux), with a few exceptions like les pneus." },
    { re: /al$/i, tip: "Nouns ending in -al usually become -aux (le journal → les journaux), except a few like les festivals." },
    { re: /[sxz]$/i, tip: "Nouns already ending in -s, -x or -z don't change (le bras → les bras)." },
    { re: /./, tip: "Most nouns just add a silent -s (le livre → les livres)." },
  ],
  it: [
    { re: /(ca|ga)$/i, tip: "Feminine nouns ending in -ca and -ga keep the hard sound: -che, -ghe (l’amica → le amiche)." },
    { re: /(co|go)$/i, tip: "Nouns ending in -co and -go usually become -chi, -ghi (il gioco → i giochi), but some become -ci, -gi (l’amico → gli amici)." },
    { re: /o$/i, tip: "Nouns ending in -o change to -i (il libro → i libri); a few irregular ones like l’uovo → le uova don't." },
    { re: /a$/i, article: ["la"], tip: "Feminine nouns ending in -a change to -e (la casa → le case)." },
    { re: /a$/i, tip: "Masculine nouns ending in -a change to -i (il problema → i problemi); feminine ones change to -e (la casa → le case)." },
    { re: /e$/i, tip: "Nouns ending in -e change to -i (il fiore → i fiori, la chiave → le chiavi)." },
    { re: /./, tip: "Nouns ending in a consonant or an accented vowel don't change (il film → i film, la città → le città)." },
  ],
  pt: [
    { re: /ão$/i, tip: "Nouns ending in -ão usually become -ões (a canção → as canções); some take -ães or -ãos (o pão → os pães, a mão → as mãos)." },
    { re: /m$/i, tip: "Nouns ending in -m change to -ns (o homem → os homens)." },
    { re: /l$/i, tip: "Nouns ending in -l change to -is, with an accent on some (o animal → os animais, o papel → os papéis)." },
    { re: /s$/i, tip: "Nouns ending in -s add -es when the last syllable is stressed (o mês → os meses) and don't change when it isn't (o lápis → os lápis)." },
    { re: /[rz]$/i, tip: "Nouns ending in -r and -z add -es (a flor → as flores, a luz → as luzes)." },
    { re: /./, tip: "Nouns ending in a vowel add -s (o livro → os livros)." },
  ],
};

const findTip = (rules: Rule[] | undefined, noun: string, article: string | null | undefined) =>
  rules?.find((r) => r.re.test(noun) && (!r.article || (article != null && r.article.includes(article))))?.tip ?? null;

export function articleTip(noun: string, lang: string): string | null {
  return findTip(ARTICLE_RULES[lc(lang)], noun, null);
}

/** The plural tip can depend on the noun's gender (German -er/-el, Italian -a). */
export function pluralTip(noun: string, lang: string, article?: string | null): string | null {
  return findTip(PLURAL_RULES[lc(lang)], noun, article);
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

/* ---------------------------- in Learn / cards ---------------------------- */

const GENDER_OF: Record<string, Record<string, "m" | "f" | "n">> = {
  de: { der: "m", die: "f", das: "n" },
  es: { el: "m", la: "f" },
  fr: { le: "m", la: "f" },
  it: { il: "m", lo: "m", la: "f" },
  pt: { o: "m", a: "f" },
};

/** Grammatical gender shown by a definite article (null for l', which hides it). */
export function articleGender(article: string | null, lang: string): "m" | "f" | "n" | null {
  return article ? (GENDER_OF[lc(lang)]?.[article] ?? null) : null;
}

/** How a card's word is shown and asked: its article (from the term or stored), the bare noun and the full form. */
export function nounForms(card: { term: string; article?: string | null; plural?: string | null }, lang: string) {
  const split = splitArticle(card.term, lang);
  const article = split.article ?? (card.article && genderArticles(lang).includes(card.article) ? card.article : null);
  const full = split.article || !article ? card.term.trim() : article.endsWith("'") ? `${article}${split.noun}` : `${article} ${split.noun}`;
  const plural = hasPlural(card.plural) ? card.plural!.trim() : null;
  const pa = plural ? pluralArticle(article, lang) : null;
  return {
    article,
    noun: split.noun,
    /** The word with its article: what a writing question expects ("das Buch"). */
    full,
    plural,
    /** "die Bücher" */
    pluralFull: plural ? (pa ? `${pa} ${plural}` : plural) : null,
  };
}
