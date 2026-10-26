import { describe, expect, it } from "vitest";
import { computeStreak, localDay } from "@/lib/data";
import { pcmToWav } from "@/lib/gemini";
import { pickBestImage } from "@/lib/images";
import { getLanguage, isRtl, LANGUAGES } from "@/lib/languages";
import { levenshtein, similarity } from "@/lib/text";

describe("streak", () => {
  it("counts consecutive days ending today or yesterday", () => {
    expect(computeStreak(["2026-03-01", "2026-03-02", "2026-03-03"], "2026-03-03")).toBe(3);
    expect(computeStreak(["2026-03-01", "2026-03-02"], "2026-03-03")).toBe(2);
    expect(computeStreak(["2026-03-01"], "2026-03-03")).toBe(0);
    expect(computeStreak([], "2026-03-03")).toBe(0);
  });
  it("localDay applies the timezone offset", () => {
    expect(localDay(new Date("2026-03-03T23:30:00Z"), -60)).toBe("2026-03-04");
    expect(localDay(new Date("2026-03-03T00:30:00Z"), 300)).toBe("2026-03-02");
  });
});

describe("images", () => {
  it("picks the first suitable image (landscape/square, ≥ 200 px)", () => {
    const img = (w: number | null, h: number | null, mime = "image/jpeg") => ({
      thumbUrl: `https://x/${w}x${h}`,
      url: "",
      width: w,
      height: h,
      attribution: "",
      mime,
    });
    expect(pickBestImage([img(100, 100), img(300, 600), img(800, 600)])?.thumbUrl).toBe("https://x/800x600");
    expect(pickBestImage([img(null, null)])?.thumbUrl).toBe("https://x/nullxnull");
    expect(pickBestImage([img(800, 600, "video/mp4")])).toBeNull();
    expect(pickBestImage([])).toBeNull();
  });
});

describe("wav", () => {
  it("wraps PCM in a 44-byte RIFF header", () => {
    const wav = pcmToWav(Buffer.alloc(100), 24000);
    expect(wav.length).toBe(144);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(100);
  });
});

describe("languages", () => {
  it("has ~30 languages with RTL flags", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(30);
    expect(isRtl("ar-SA")).toBe(true);
    expect(isRtl("he-IL")).toBe(true);
    expect(isRtl("fa-IR")).toBe(true);
    expect(isRtl("es-ES")).toBe(false);
    expect(getLanguage("es-AR").name).toContain("Spanish");
  });
  it("levenshtein/similarity", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "")).toBe(1);
  });
});
