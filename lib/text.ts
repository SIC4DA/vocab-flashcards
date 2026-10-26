/** Shared string helpers (pure). */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const A = Array.from(a);
  const B = Array.from(b);
  if (A.length === 0) return B.length;
  if (B.length === 0) return A.length;
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[B.length];
}

/** 1 − distance / max length, in [0, 1]. */
export function similarity(a: string, b: string): number {
  const max = Math.max(Array.from(a).length, Array.from(b).length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .normalize("NFC");
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Split "car / automobile; auto" into accepted alternatives. */
export function acceptedAnswers(expected: string): string[] {
  const parts = expected
    .split(/[/;]/)
    .map((p) => collapseWhitespace(p))
    .filter(Boolean);
  return parts.length ? parts : [collapseWhitespace(expected)];
}
