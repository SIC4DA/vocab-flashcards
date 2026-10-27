import { describe, expect, it } from "vitest";
import { scoreRecordingFile, titleVariants } from "@/lib/recording-match";
import { lookupCandidates } from "@/lib/pronounce";
import { looksUnpicturable } from "@/lib/auto-image";
import { currentTopic, deckTopics, NEW_PROGRESS, planLearnSession, topicFinished, topicSummary, type Progress, type StudyCard } from "@/lib/learn";
import { geminiKeySchema } from "@/lib/validation";
import { pickVoice, voiceQuality } from "@/lib/tts";

describe("recording file matching", () => {
  it("prefers the plain language-word file", () => {
    expect(scoreRecordingFile("Datei:De-Hund.ogg", "Hund", "de-DE")).toBe(100);
    expect(scoreRecordingFile("File:De-Hund2.ogg", "Hund", "de-DE")).toBe(90);
    expect(scoreRecordingFile("File:De-at-Hund.ogg", "Hund", "de-DE")).toBe(80);
    expect(scoreRecordingFile("File:En-us-apple.ogg", "apple", "en-US")).toBe(95);
    expect(scoreRecordingFile("File:En-uk-apple.ogg", "apple", "en-US")).toBe(80);
    expect(scoreRecordingFile("File:De-Guten_Morgen.oga", "guten Morgen", "de-DE")).toBe(100);
  });
  it("accepts Lingua Libre recordings only for the right language", () => {
    expect(scoreRecordingFile("Archivo:LL-Q1321 (spa)-Millars-manzana.wav", "manzana", "es-ES")).toBe(85);
    expect(scoreRecordingFile("File:LL-Q9035 (dan)-Someone-hund.wav", "hund", "de-DE")).toBe(0);
  });
  it("rejects other words, phrases containing the word, other languages and non-audio files", () => {
    expect(scoreRecordingFile("Datei:De-gelehriger Hund.ogg", "Hund", "de-DE")).toBe(0);
    expect(scoreRecordingFile("File:Nl-hond.ogg", "Hund", "de-DE")).toBe(0);
    expect(scoreRecordingFile("File:De-Hund.jpg", "Hund", "de-DE")).toBe(0);
    expect(scoreRecordingFile("File:De-Hunde.ogg", "Hund", "de-DE")).toBe(0);
  });
  it("looks up case variants and article-less nouns", () => {
    expect(titleVariants("hund")).toEqual(["hund", "Hund"]);
    expect(lookupCandidates("der Hund", "de-DE")).toEqual([
      { word: "der Hund", prefix: null },
      { word: "Hund", prefix: "der" },
    ]);
    expect(lookupCandidates("l'arbre", "fr-FR")[1]).toEqual({ word: "arbre", prefix: "l'" });
    expect(lookupCandidates("sprechen", "de-DE")).toHaveLength(1);
  });
});

describe("device voice choice", () => {
  const v = (name: string, lang: string, localService = true) => ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;
  it("prefers natural/Google/premium voices over compact or novelty ones", () => {
    const voices = [v("Eddy (German (Germany))", "de-DE"), v("Google Deutsch", "de-DE", false), v("Anna (Enhanced)", "de-DE")];
    expect(pickVoice(voices, "de-DE")?.name).toBe("Anna (Enhanced)");
    expect(voiceQuality(v("Microsoft Katja Online (Natural)", "de-DE", false))).toBeGreaterThan(voiceQuality(v("Google Deutsch", "de-DE", false)));
    expect(pickVoice([v("Zarvox", "en-US"), v("Samantha", "en-US")], "en-US")?.name).toBe("Samantha");
  });
});

describe("pictures without AI", () => {
  it("skips English verb definitions", () => {
    expect(looksUnpicturable("to spell", "en-US")).toBe(true);
    expect(looksUnpicturable("To think", "en-GB")).toBe(true);
    expect(looksUnpicturable("towel", "en-US")).toBe(false);
    expect(looksUnpicturable("to spell", "de-DE")).toBe(false);
  });
});

describe("Gemini key formats", () => {
  it("accepts new AQ. auth keys and old AIza keys", () => {
    expect(geminiKeySchema.safeParse({ apiKey: "AQ.Ab8RN6KfZ0tXyz-abc_DEF.ghi1234567890" }).success).toBe(true);
    expect(geminiKeySchema.safeParse({ apiKey: "AIzaSyA1234567890abcdefghijklmnopqrstu" }).success).toBe(true);
    expect(geminiKeySchema.safeParse({ apiKey: "  AQ.Ab8RN6KfZ0tXyz-abc_DEF.ghi1234567890  " }).success).toBe(true);
    expect(geminiKeySchema.safeParse({ apiKey: "has spaces inside the key 123456" }).success).toBe(false);
    expect(geminiKeySchema.safeParse({ apiKey: "short" }).success).toBe(false);
  });
});

describe("topics in Learn", () => {
  const now = new Date("2026-03-01T10:00:00Z");
  const today = "2026-03-01";
  const card = (i: number, group: string | null, progress: Partial<Progress> = {}): StudyCard => ({
    id: `c${i}`,
    deckId: "d",
    term: `t${i}`,
    definition: `d${i}`,
    example: "",
    imageUrl: null,
    imageAttribution: null,
    group,
    termLang: "de-DE",
    definitionLang: "en-US",
    progress: { ...NEW_PROGRESS, ...progress },
  });
  const newIds = (cards: StudyCard[], newAllowed = 10) =>
    planLearnSession(cards, { now, today, newAllowed, stepsPerDay: 2 }).items.filter((i) => i.kind === "new").map((i) => i.id);

  it("uses AI topics in order of first appearance, new words only from the current topic", () => {
    const cards = [card(1, "Food"), card(2, "Animals"), card(3, "Food"), card(4, "Animals"), card(5, "Food")];
    expect(deckTopics(cards).map((t) => t.label)).toEqual(["Food", "Animals"]);
    expect(newIds(cards)).toEqual(["c1", "c3", "c5"]);
  });

  it("without AI topics, splits the deck into sets of 8 in deck order", () => {
    const cards = Array.from({ length: 20 }, (_, i) => card(i, null));
    expect(deckTopics(cards).map((t) => [t.label, t.cards.length])).toEqual([
      ["Set 1", 8],
      ["Set 2", 8],
      ["Set 3", 4],
    ]);
    expect(newIds(cards)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
  });

  it("starts the next topic once 3 of 4 words in the current one can be written", () => {
    const food = [0, 1, 2, 3].map((i) => card(i, "Food", { stage: 4 }));
    const animals = [4, 5].map((i) => card(i, "Animals"));
    // all 4 written → finished
    expect(currentTopic(deckTopics([...food, ...animals]))?.label).toBe("Animals");
    // one hard word still at stage 2: 3/4 written → still finished, it keeps being practised
    food[3] = card(3, "Food", { stage: 2 });
    expect(currentTopic(deckTopics([...food, ...animals]))?.label).toBe("Animals");
    // two words not written yet → Food continues, no Animals words yet
    food[2] = card(2, "Food", { stage: 3 });
    expect(currentTopic(deckTopics([...food, ...animals]))?.label).toBe("Food");
    expect(newIds([...food, ...animals])).toEqual([]);
    // a word of the topic not even seen yet → topic not finished
    expect(topicFinished({ key: "x", label: "x", cards: [card(9, "x", { stage: 6 }), card(10, "x")] })).toBe(false);
  });

  it("summarises topic progress for the deck page", () => {
    const cards = [card(1, "Food", { stage: 6 }), card(2, "Food", { stage: 4 }), card(3, "Animals")];
    expect(topicSummary(deckTopics(cards))).toEqual([
      expect.objectContaining({ label: "Food", total: 2, mastered: 1, written: 2, new: 0, finished: true, current: false }),
      expect.objectContaining({ label: "Animals", total: 1, new: 1, finished: false, current: true }),
    ]);
  });
});
