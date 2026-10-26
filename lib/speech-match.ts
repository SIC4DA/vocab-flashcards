/** Matching recognized speech against the expected term (pure). */
import { acceptedAnswers, collapseWhitespace, similarity, stripDiacritics } from "./text";

export const SPEECH_SIMILARITY_THRESHOLD = 0.8;

export function normalizeSpeech(s: string): string {
  return collapseWhitespace(
    stripDiacritics(s.normalize("NFC").toLocaleLowerCase()).replace(/[\p{P}\p{S}]+/gu, " "),
  );
}

export type SpeechMatch = {
  correct: boolean;
  heard: string;
  similarity: number;
};

/** Correct if any alternative equals (after normalization) or is ≥ 0.8 similar to the term. */
export function matchSpeech(alternatives: string[], term: string): SpeechMatch {
  const targets = acceptedAnswers(term).map(normalizeSpeech).filter(Boolean);
  let best: SpeechMatch = { correct: false, heard: alternatives[0] ?? "", similarity: 0 };
  for (const alt of alternatives) {
    const heard = normalizeSpeech(alt);
    if (!heard) continue;
    for (const target of targets) {
      const sim = heard === target ? 1 : similarity(heard, target);
      if (sim > best.similarity) best = { correct: sim >= SPEECH_SIMILARITY_THRESHOLD, heard: alt, similarity: sim };
    }
  }
  return best;
}
