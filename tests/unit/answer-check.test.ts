import { describe, expect, it } from "vitest";
import { checkAnswer, diffSegments, normalizeAnswer, typoTolerance } from "@/lib/answer-check";

describe("checkAnswer", () => {
  it("ignores case and surrounding/collapsed whitespace", () => {
    expect(checkAnswer("  La   Manzana ", "la manzana").verdict).toBe("correct");
  });
  it("normalizes Unicode to NFC", () => {
    const decomposed = "café"; // e + combining acute
    expect(checkAnswer(decomposed, "café").verdict).toBe("correct");
  });
  it("ignores trailing punctuation", () => {
    expect(checkAnswer("¿Qué tal?", "qué tal").verdict).toBe("correct");
    expect(checkAnswer("hola!", "hola").correct).toBe(true);
  });
  it("accent-only mismatch: lenient by default, wrong when strict", () => {
    const lenient = checkAnswer("cafe", "café");
    expect(lenient).toMatchObject({ verdict: "accent", correct: true });
    const strict = checkAnswer("cafe", "café", { strictAccents: true });
    expect(strict).toMatchObject({ verdict: "accent", correct: false });
    expect(checkAnswer("strasse", "Straße").verdict).toBe("accent");
  });
  it("typo tolerance thresholds: 0 for < 5, 1 for ≥ 5, 2 for ≥ 10", () => {
    expect(typoTolerance(4)).toBe(0);
    expect(typoTolerance(5)).toBe(1);
    expect(typoTolerance(10)).toBe(2);
    expect(checkAnswer("gata", "gato").verdict).toBe("wrong"); // 4 chars, no tolerance
    expect(checkAnswer("perrp", "perro")).toMatchObject({ verdict: "typo", correct: false });
    expect(checkAnswer("pexxo", "perro").verdict).toBe("wrong"); // distance 2 on 5 chars
    expect(checkAnswer("biblioteka", "biblioteca").verdict).toBe("typo");
    expect(checkAnswer("bibliotexx", "biblioteca").verdict).toBe("typo"); // 2 on 10
    expect(checkAnswer("bibliozzzz", "biblioteca").verdict).toBe("wrong");
  });
  it("accepts any part of answers separated by / or ;", () => {
    expect(checkAnswer("automobile", "car / automobile").correct).toBe(true);
    expect(checkAnswer("car", "car / automobile").correct).toBe(true);
    expect(checkAnswer("auto", "car; auto").correct).toBe(true);
    expect(checkAnswer("bus", "car / automobile").correct).toBe(false);
    expect(checkAnswer("automobile", "car / automobile").expected).toBe("automobile");
  });
  it("ignores leading articles only when enabled", () => {
    expect(checkAnswer("manzana", "la manzana").verdict).not.toBe("correct");
    expect(checkAnswer("manzana", "la manzana", { ignoreArticles: true, lang: "es-ES" }).verdict).toBe("correct");
    expect(checkAnswer("der Hund", "Hund", { ignoreArticles: true, lang: "de-DE" }).verdict).toBe("correct");
    expect(checkAnswer("arbre", "l'arbre", { ignoreArticles: true, lang: "fr-FR" }).verdict).toBe("correct");
  });
  it("treats empty input as wrong", () => {
    expect(checkAnswer("", "hola")).toMatchObject({ verdict: "wrong", correct: false });
    expect(checkAnswer("   ", "hola").correct).toBe(false);
  });
  it("normalizeAnswer", () => {
    expect(normalizeAnswer("  Hello   World. ")).toBe("hello world");
  });
});

describe("diffSegments", () => {
  it("marks differing characters of the expected answer", () => {
    const segs = diffSegments("perrp", "perro");
    expect(segs.map((s) => s.text).join("")).toBe("perro");
    expect(segs.find((s) => !s.ok)?.text).toBe("o");
  });
});
