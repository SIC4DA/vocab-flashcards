import { describe, expect, it } from "vitest";
import { applyDailyAnswer, lastDays, missScore, planDailyReview } from "@/lib/daily";
import { checkNounAnswer } from "@/lib/answer-check";
import {
  articleGender,
  articleTip,
  buildGrammarRound,
  checkPlural,
  fullForms,
  nounForms,
  pluralOptions,
  pluralTip,
  splitArticle,
  splitTermPlural,
  umlaut,
} from "@/lib/grammar";
import { NEW_PROGRESS, type Progress, type StudyCard } from "@/lib/learn";

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe("articles", () => {
  it("splits the article off the term", () => {
    expect(splitArticle("das Buch", "de-DE")).toEqual({ article: "das", noun: "Buch" });
    expect(splitArticle("Der  Hund", "de-DE")).toEqual({ article: "der", noun: "Hund" });
    expect(splitArticle("l'arbre", "fr-FR")).toEqual({ article: "l'", noun: "arbre" });
    expect(splitArticle("l’école", "fr-FR")).toEqual({ article: "l'", noun: "école" });
    expect(splitArticle("el perro", "es-ES")).toEqual({ article: "el", noun: "perro" });
    // "ein" is not a gender article; English has none.
    expect(splitArticle("ein Buch", "de-DE").article).toBeNull();
    expect(splitArticle("the dog", "en-US").article).toBeNull();
    expect(splitArticle("dieser", "de-DE").article).toBeNull();
  });

  it("reads 'das Buch, die Bücher' from an import line", () => {
    expect(splitTermPlural("das Buch, die Bücher", "de-DE")).toEqual({ term: "das Buch", plural: "Bücher" });
    expect(splitTermPlural("der Hund, Hunde", "de-DE")).toEqual({ term: "der Hund", plural: "Hunde" });
    expect(splitTermPlural("el lápiz, los lápices", "es-ES")).toEqual({ term: "el lápiz", plural: "lápices" });
    // Not article + noun: left alone.
    expect(splitTermPlural("gut, danke", "de-DE")).toEqual({ term: "gut, danke", plural: null });
    expect(splitTermPlural("the dog, dogs", "en-US")).toEqual({ term: "the dog, dogs", plural: null });
  });

  // Every tip must be true for the word it's shown with: rules are checked on words that fit
  // and on common look-alikes that must NOT get that tip.
  it("gives a correct article tip, and none for look-alike words that break the rule", () => {
    const de = (w: string) => articleTip(w, "de-DE") ?? "";
    expect(de("Zeitung")).toMatch(/are die/);
    expect(de("Freiheit")).toMatch(/are die/);
    expect(de("Bäckerei")).toMatch(/are die/);
    expect(de("Konferenz")).toMatch(/are die/);
    expect(de("Mädchen")).toMatch(/always das/);
    expect(de("Fräulein")).toMatch(/always das/);
    expect(de("Kuchen")).not.toMatch(/always das/); // der Kuchen
    expect(de("Knochen")).not.toMatch(/always das/);
    expect(de("Ei")).not.toMatch(/die/); // das Ei
    expect(de("Spion")).not.toMatch(/are die/); // der Spion
    expect(de("Tanz")).not.toMatch(/are die/); // der Tanz
    expect(de("Museum")).toMatch(/das/);
    expect(de("Baum")).not.toMatch(/Latin/); // der Baum
    expect(de("Irrtum")).not.toMatch(/Latin/); // der Irrtum
    expect(de("Motor")).toMatch(/der/);
    expect(de("Tor")).toBe(""); // das Tor
    expect(de("Frühling")).toMatch(/are der/);
    expect(de("Polizist")).toMatch(/der/);
    expect(de("Frist")).toBe(""); // die Frist
    expect(de("Gemüse")).toMatch(/Ge-/);
    expect(de("Lampe")).toMatch(/die/);
    expect(articleTip("canción", "es-ES")).toMatch(/are la/);
    expect(articleTip("cama", "es-ES")).toMatch(/la cama/); // -ma is split, the tip says so
    expect(articleTip("mano", "es-ES")).toMatch(/la mano/);
    expect(articleTip("côté", "fr-FR")).toMatch(/le côté/);
    expect(articleTip("arbre", "fr-FR")).toMatch(/l’/);
    expect(articleTip("héros", "fr-FR") ?? "").not.toMatch(/l’/); // le héros: aspirated h
    expect(articleTip("stazione", "it-IT")).toMatch(/feminine/);
    expect(articleTip("studente", "it-IT")).toMatch(/lo/);
    expect(articleTip("Hund", "en-US")).toBeNull();
  });

  it("gives a plural tip that fits the noun's gender", () => {
    const de = (w: string, a: string) => pluralTip(w, "de-DE", a) ?? "";
    expect(de("Zeitung", "die")).toMatch(/add -en/);
    expect(de("Lehrerin", "die")).toMatch(/-nen/);
    expect(de("Termin", "der")).not.toMatch(/-nen/); // der Termin → die Termine
    expect(de("Mädchen", "das")).toMatch(/don't change/);
    expect(de("Kuchen", "der")).toMatch(/stay the same/); // der Kuchen → die Kuchen
    expect(de("Lehrer", "der")).toMatch(/stay the same/);
    expect(de("Schwester", "die")).toMatch(/add -n/);
    expect(de("Lampe", "die")).toMatch(/add -n/);
    expect(de("Auto", "das")).toMatch(/add -s/);
    expect(de("Frau", "die")).not.toMatch(/add -s/); // die Frauen
    expect(de("Ei", "das")).not.toMatch(/add -s/); // die Eier
    expect(de("Buch", "das")).toMatch(/-er with an umlaut/);
    expect(de("Hund", "der")).toMatch(/add -e/);
    expect(de("Hand", "die")).toMatch(/-en or -n/);
    expect(pluralTip("lápiz", "es-ES")).toMatch(/-ces/);
    expect(pluralTip("lunes", "es-ES")).toMatch(/don't change/);
    expect(pluralTip("rubí", "es-ES")).toMatch(/vowel/);
    expect(pluralTip("journal", "fr-FR")).toMatch(/-aux/);
    expect(pluralTip("amica", "it-IT", "la")).toMatch(/-che/);
    expect(pluralTip("problema", "it-IT", "il")).toMatch(/Masculine/);
    expect(pluralTip("casa", "it-IT", "la")).toMatch(/to -e/);
    expect(pluralTip("canção", "pt-BR")).toMatch(/-ões/);
  });
});

describe("plurals", () => {
  it("checks plurals strictly but forgives case and the plural article", () => {
    expect(checkPlural("Bücher", "Bücher", "de-DE")).toBe(true);
    expect(checkPlural("die bücher", "Bücher", "de-DE")).toBe(true);
    expect(checkPlural("Bucher", "Bücher", "de-DE")).toBe(false);
    expect(checkPlural("Strasse", "Straße", "de-DE")).toBe(false);
    expect(checkPlural("", "Bücher", "de-DE")).toBe(false);
    expect(checkPlural("los perros", "perros", "es-ES")).toBe(true);
  });

  it("builds umlauts", () => {
    expect(umlaut("Buch")).toBe("Büch");
    expect(umlaut("Haus")).toBe("Häus");
    expect(umlaut("Vater")).toBe("Väter");
    expect(umlaut("Kind")).toBe("Kind");
  });

  it("offers the right plural among 3 unique look-alikes", () => {
    for (let i = 0; i < 20; i++) {
      const opts = pluralOptions("Buch", "Bücher", "de-DE", Math.random);
      expect(opts).toHaveLength(4);
      expect(opts).toContain("Bücher");
      expect(new Set(opts.map((o) => o.toLowerCase())).size).toBe(4);
    }
  });

  it("writes the full forms", () => {
    expect(fullForms("Buch", "das", "Bücher", "de-DE")).toBe("das Buch → die Bücher");
    expect(fullForms("perro", "el", "perros", "es-ES")).toBe("el perro → los perros");
    expect(fullForms("Obst", "das", "—", "de-DE")).toBe("das Obst (no plural)");
  });
});

describe("grammar round", () => {
  const cards = [
    { id: "a", term: "das Buch", definition: "book", article: null, plural: "Bücher" },
    { id: "b", term: "Hund", definition: "dog", article: "der", plural: null },
    { id: "c", term: "gehen", definition: "to go", article: null, plural: null },
  ];
  it("asks the article and the plural of each noun, skipping non-nouns", () => {
    const round = buildGrammarRound(cards, "de-DE", { rand: seq(0.3, 0.7, 0.1) });
    const kinds = round.map((q) => `${q.cardId}:${q.kind}`).sort();
    expect(kinds).toEqual(["a:article", "a:plural_mc", "b:article"]);
    const art = round.find((q) => q.cardId === "a" && q.kind === "article")!;
    expect(art).toMatchObject({ noun: "Buch", answer: "das", options: ["der", "die", "das"] });
  });
  it("asks known plurals as typing", () => {
    const round = buildGrammarRound(cards, "de-DE", { known: new Set(["a"]) });
    expect(round.find((q) => q.cardId === "a" && q.kind !== "article")!.kind).toBe("plural_write");
  });
});

/* ------------------------------- daily review ------------------------------- */

const NOW = new Date("2026-06-10T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
function card(id: string, p: Partial<Progress>): StudyCard {
  return {
    id,
    deckId: "d",
    term: id,
    definition: id,
    example: "",
    imageUrl: null,
    imageAttribution: null,
    termLang: "de-DE",
    definitionLang: "en-US",
    progress: { ...NEW_PROGRESS, ...p },
  };
}

describe("daily review plan", () => {
  it("uses known words only: due first, then the most missed, then the longest unseen", () => {
    const cards = [
      card("new", { stage: 0 }),
      card("learning", { stage: 3, dueAt: day(-1) }),
      card("fresh", { stage: 6, dueAt: day(5), lastReviewedAt: day(-1) }),
      card("old", { stage: 6, dueAt: day(5), lastReviewedAt: day(-20) }),
      card("missed", { stage: 6, dueAt: day(5), lapses: 2, modeStats: { write: { correct: 3, wrong: 4 } } }),
      card("due2", { stage: 6, dueAt: day(-1) }),
      card("due1", { stage: 4, dueAt: day(-3) }),
    ];
    expect(planDailyReview(cards, NOW).map((c) => c.id)).toEqual(["due1", "due2", "missed", "old", "fresh"]);
    expect(planDailyReview(cards, NOW, { size: 2 }).map((c) => c.id)).toEqual(["due1", "due2"]);
    expect(planDailyReview(cards, NOW, { exclude: new Set(["due1", "due2", "missed"]) }).map((c) => c.id)).toEqual(["old", "fresh"]);
    expect(missScore(cards[4].progress)).toBe(8);
  });

  it("is empty without known words", () => {
    expect(planDailyReview([card("x", { stage: 2 })], NOW)).toEqual([]);
  });
});

describe("daily review answers", () => {
  const mastered: Progress = { ...NEW_PROGRESS, stage: 6, intervalDays: 20, reps: 4, dueAt: day(10), lastReviewedAt: day(-10) };

  it("a right answer to a word that isn't due only counts in the stats", () => {
    const r = applyDailyAnswer(mastered, { correct: true, type: "write" }, NOW);
    expect(r.progress.dueAt).toBe(mastered.dueAt);
    expect(r.progress.intervalDays).toBe(20);
    expect(r.progress.stage).toBe(6);
    expect(r.progress.lastReviewedAt).toBe(NOW.toISOString());
    expect(r.progress.modeStats.write).toEqual({ correct: 1, wrong: 0 });
  });

  it("a wrong answer drops the word back to Written and brings it back soon", () => {
    const r = applyDailyAnswer(mastered, { correct: false, type: "write" }, NOW);
    expect(r.progress.stage).toBe(4);
    expect(r.progress.lapses).toBe(1);
    expect(new Date(r.progress.dueAt!).getTime()).toBeLessThan(new Date(mastered.dueAt!).getTime());
  });

  it("a due word is reviewed normally", () => {
    const due = { ...mastered, dueAt: day(-1) };
    const r = applyDailyAnswer(due, { correct: true, grade: 4, type: "write" }, NOW);
    expect(r.progress.stage).toBe(6);
    expect(r.progress.intervalDays).toBeGreaterThan(20);
  });

  it("lists the last 7 days", () => {
    expect(lastDays("2026-03-02")).toEqual([
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });
});

describe("articles inside Learn", () => {
  it("shows the full forms of a noun, adding a stored article", () => {
    expect(nounForms({ term: "Buch", article: "das", plural: "Bücher" }, "de-DE")).toEqual({
      article: "das",
      noun: "Buch",
      full: "das Buch",
      plural: "Bücher",
      pluralFull: "die Bücher",
    });
    expect(nounForms({ term: "der Hund", article: null, plural: null }, "de-DE")).toMatchObject({ article: "der", full: "der Hund", pluralFull: null });
    expect(nounForms({ term: "gehen" }, "de-DE")).toMatchObject({ article: null, full: "gehen" });
    expect(nounForms({ term: "dog", article: "der" }, "en-US")).toMatchObject({ article: null, full: "dog" });
    expect(articleGender("die", "de-DE")).toBe("f");
    expect(articleGender("l'", "fr-FR")).toBeNull();
  });

  it("a written noun needs its article", () => {
    const forms = nounForms({ term: "Buch", article: "das" }, "de-DE");
    const opts = { genderArticles: ["der", "die", "das"], lang: "de-DE" };
    expect(checkNounAnswer("das Buch", forms, opts)).toMatchObject({ verdict: "correct", correct: true });
    expect(checkNounAnswer("Das buch", forms, opts).correct).toBe(true);
    expect(checkNounAnswer("Buch", forms, opts)).toMatchObject({ verdict: "article", correct: false, expected: "das Buch" });
    expect(checkNounAnswer("der Buch", forms, opts)).toMatchObject({ verdict: "article", correct: false });
    expect(checkNounAnswer("das Buh", forms, opts).verdict).toBe("typo");
    expect(checkNounAnswer("Heft", forms, opts).verdict).toBe("wrong");
  });
});
