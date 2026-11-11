/**
 * Written-answer checking (pure).
 * Verdicts:
 *  - "correct": exact after normalization
 *  - "accent":  differs only in diacritics → counts as correct unless strictAccents
 *  - "typo":    within the Levenshtein tolerance → counts as incorrect unless overridden
 *  - "wrong"
 */
import { getLanguage } from "./languages";
import { acceptedAnswers, collapseWhitespace, levenshtein, stripDiacritics } from "./text";

/** "article": the word was right but its article was missing or wrong (writing nouns of gendered languages). */
export type Verdict = "correct" | "accent" | "typo" | "article" | "wrong";

export type CheckOptions = {
  strictAccents?: boolean;
  ignoreArticles?: boolean;
  lang?: string;
};

export type CheckResult = {
  verdict: Verdict;
  correct: boolean;
  /** The accepted answer closest to the input (for display). */
  expected: string;
};

const TRAILING_PUNCT = /[\s.,!?;:¡¿。、！？…"'«»“”]+$/u;
const LEADING_PUNCT = /^[\s¡¿"'«»“”]+/u;

export function stripArticles(s: string, lang?: string): string {
  const articles = lang ? getLanguage(lang).articles : undefined;
  const list = articles ?? ["a", "an", "the"];
  for (const art of list) {
    if (art.endsWith("'")) {
      if (s.startsWith(art) && s.length > art.length) return s.slice(art.length).trim();
    } else if (s.startsWith(art + " ") && s.length > art.length + 1) {
      return s.slice(art.length + 1).trim();
    }
  }
  return s;
}

export function normalizeAnswer(s: string, opts: CheckOptions = {}): string {
  let out = collapseWhitespace(s.normalize("NFC")).toLocaleLowerCase();
  out = out.replace(TRAILING_PUNCT, "").replace(LEADING_PUNCT, "");
  if (opts.ignoreArticles) out = stripArticles(out, opts.lang);
  return out;
}

/** Max edit distance tolerated as a typo for an answer of this length. */
export function typoTolerance(length: number): number {
  if (length >= 10) return 2;
  if (length >= 5) return 1;
  return 0;
}

export function checkAnswer(input: string, expectedRaw: string, opts: CheckOptions = {}): CheckResult {
  const alternatives = acceptedAnswers(expectedRaw);
  const given = normalizeAnswer(input, opts);
  if (!given) return { verdict: "wrong", correct: false, expected: alternatives[0] };

  let best: CheckResult | null = null;
  const rank: Record<Verdict, number> = { correct: 3, accent: 2, typo: 1, article: 0, wrong: 0 };

  for (const alt of alternatives) {
    const exp = normalizeAnswer(alt, opts);
    let verdict: Verdict = "wrong";
    if (given === exp) verdict = "correct";
    else if (stripDiacritics(given) === stripDiacritics(exp)) verdict = "accent";
    else {
      const tol = typoTolerance(Array.from(exp).length);
      if (tol > 0 && levenshtein(stripDiacritics(given), stripDiacritics(exp)) <= tol) verdict = "typo";
    }
    const correct = verdict === "correct" || (verdict === "accent" && !opts.strictAccents);
    const result = { verdict, correct, expected: alt };
    if (!best || rank[verdict] > rank[best.verdict]) best = result;
    if (verdict === "correct") break;
  }
  return best!;
}

/**
 * Character-level diff for highlighting typos: returns segments of the expected
 * string marked as matching or differing from the input.
 */
export function diffSegments(input: string, expected: string): { text: string; ok: boolean }[] {
  const a = Array.from(input.toLocaleLowerCase());
  const b = Array.from(expected);
  const bl = b.map((c) => c.toLocaleLowerCase());
  // LCS table
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const marks: boolean[] = new Array(b.length).fill(false);
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === bl[j]) {
      marks[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const segs: { text: string; ok: boolean }[] = [];
  b.forEach((ch, k) => {
    const last = segs[segs.length - 1];
    if (last && last.ok === marks[k]) last.text += ch;
    else segs.push({ text: ch, ok: marks[k] });
  });
  return segs;
}

/**
 * Writing a noun of a gendered language: the article is part of the word ("das Buch").
 * Right word with a missing or wrong article → verdict "article" (not correct).
 */
export function checkNounAnswer(
  input: string,
  forms: { article: string | null; noun: string; full: string },
  opts: CheckOptions & { genderArticles: string[] },
): CheckResult {
  const res = checkAnswer(input, forms.full, opts);
  if (res.correct || !forms.article) return res;
  const given = input.trim().replace(/\s+/g, " ");
  const lower = given.toLowerCase();
  let bare = given;
  for (const art of opts.genderArticles) {
    if (art.endsWith("'") ? lower.startsWith(art) : lower.startsWith(`${art} `)) {
      bare = given.slice(art.length).trim();
      break;
    }
  }
  const nounOnly = checkAnswer(bare, forms.noun, opts);
  if (nounOnly.correct || nounOnly.verdict === "typo") return { verdict: "article", correct: false, expected: forms.full };
  return res;
}
