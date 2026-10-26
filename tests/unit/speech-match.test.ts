import { describe, expect, it } from "vitest";
import { matchSpeech, normalizeSpeech, SPEECH_SIMILARITY_THRESHOLD } from "@/lib/speech-match";

describe("matchSpeech", () => {
  it("accepts an exact match after normalization (case, accents, punctuation)", () => {
    expect(matchSpeech(["La manzana."], "la manzana").correct).toBe(true);
    expect(matchSpeech(["cafe"], "café").correct).toBe(true);
    expect(matchSpeech(["¿Qué tal?"], "que tal").correct).toBe(true);
  });
  it("checks every alternative", () => {
    const m = matchSpeech(["la mañana", "la manzana", "lana"], "la manzana");
    expect(m.correct).toBe(true);
    expect(m.heard).toBe("la manzana");
    expect(m.similarity).toBe(1);
  });
  it("uses the 0.8 similarity threshold", () => {
    expect(SPEECH_SIMILARITY_THRESHOLD).toBe(0.8);
    expect(matchSpeech(["biblioteka"], "biblioteca").correct).toBe(true); // 0.9
    expect(matchSpeech(["gata"], "gato").correct).toBe(false); // 0.75
    expect(matchSpeech(["perro"], "gato").correct).toBe(false);
  });
  it("compares whole phrases for multi-word terms", () => {
    expect(matchSpeech(["manzana"], "la manzana roja").correct).toBe(false);
    expect(matchSpeech(["la manzana roja"], "la manzana roja").correct).toBe(true);
  });
  it("accepts any alternative answer of the term", () => {
    expect(matchSpeech(["coche"], "carro / coche").correct).toBe(true);
  });
  it("handles empty input", () => {
    expect(matchSpeech([], "hola").correct).toBe(false);
    expect(matchSpeech([""], "hola").correct).toBe(false);
  });
  it("normalizeSpeech strips punctuation and symbols", () => {
    expect(normalizeSpeech("¡Hola, Señor!")).toBe("hola senor");
  });
});
