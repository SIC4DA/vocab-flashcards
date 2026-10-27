import { describe, expect, it } from "vitest";
import { scoreRecordingFile, titleVariants } from "@/lib/recording-match";
import { lookupCandidates } from "@/lib/pronounce";
import { looksUnpicturable } from "@/lib/auto-image";
import { anchorGroup, NEW_PROGRESS, selectRound, type Progress, type StudyCard } from "@/lib/learn";
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

describe("topic grouping in Learn", () => {
  const now = new Date("2026-03-01T10:00:00Z");
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
  it("introduces new words topic by topic", () => {
    const cards = [card(1, "Food"), card(2, "Animals"), card(3, "Food"), card(4, "Animals"), card(5, "Food")];
    expect(selectRound(cards, { now, newAllowed: 3, roundSize: 7 }).map((c) => c.id)).toEqual(["c1", "c3", "c5"]);
  });
  it("continues the topic already being learned", () => {
    const future = "2026-03-05T00:00:00Z";
    const cards = [card(1, "Food"), card(2, "Animals", { stage: 2, dueAt: future }), card(3, "Animals"), card(4, "Food")];
    expect(anchorGroup([cards[1]], [cards[0], cards[2], cards[3]])).toBe("Animals");
    expect(selectRound(cards, { now, newAllowed: 1, roundSize: 7 }).map((c) => c.id)).toEqual(["c2", "c3"]);
  });
  it("keeps deck order without topics", () => {
    const cards = [card(1, null), card(2, null), card(3, null)];
    expect(selectRound(cards, { now, newAllowed: 2, roundSize: 7 }).map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
