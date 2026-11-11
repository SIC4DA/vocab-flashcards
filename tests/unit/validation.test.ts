import { describe, expect, it } from "vitest";
import {
  cardInputSchema,
  cardsPutSchema,
  deckInputSchema,
  LIMITS,
  passwordSchema,
  registerFormSchema,
  resolveSettings,
  usernameSchema,
  DEFAULT_SETTINGS,
} from "@/lib/validation";
import { sniffImageType } from "@/lib/image-validate";

describe("username rules", () => {
  it.each(["abc", "Alice_1", "a".repeat(20), "___"])("accepts %s", (u) => expect(usernameSchema.safeParse(u).success).toBe(true));
  it.each(["ab", "a".repeat(21), "with space", "émile", "dash-name", ""])("rejects %s", (u) =>
    expect(usernameSchema.safeParse(u).success).toBe(false),
  );
});

describe("password length", () => {
  it("requires 8–128 characters", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(128)).success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });
  it("register form requires matching confirmation", () => {
    expect(registerFormSchema.safeParse({ username: "bob", password: "password1", confirmPassword: "password2" }).success).toBe(false);
    expect(registerFormSchema.safeParse({ username: "bob", password: "password1", confirmPassword: "password1" }).success).toBe(true);
  });
});

describe("deck and card limits", () => {
  it("deck title 1–100, description ≤ 500, known languages", () => {
    expect(deckInputSchema.safeParse({ title: "", termLang: "es-ES" }).success).toBe(false);
    expect(deckInputSchema.safeParse({ title: "x".repeat(101), termLang: "es-ES" }).success).toBe(false);
    expect(deckInputSchema.safeParse({ title: "ok", description: "x".repeat(501), termLang: "es-ES" }).success).toBe(false);
    expect(deckInputSchema.safeParse({ title: "ok", termLang: "xx-YY" }).success).toBe(false);
    expect(deckInputSchema.parse({ title: "ok", termLang: "es-ES" }).definitionLang).toBe("en-US");
  });
  it("card term 1–200, definition 1–500, example ≤ 500, https image", () => {
    expect(cardInputSchema.safeParse({ term: "", definition: "x" }).success).toBe(false);
    expect(cardInputSchema.safeParse({ term: "x".repeat(201), definition: "x" }).success).toBe(false);
    expect(cardInputSchema.safeParse({ term: "x", definition: "x".repeat(501) }).success).toBe(false);
    expect(cardInputSchema.safeParse({ term: "x", definition: "y", example: "x".repeat(501) }).success).toBe(false);
    expect(cardInputSchema.safeParse({ term: "x", definition: "y", imageUrl: "http://a.com/x.png" }).success).toBe(false);
    expect(cardInputSchema.safeParse({ term: "x", definition: "y", imageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(cardInputSchema.safeParse({ term: "x", definition: "y", imageUrl: "https://a.com/x.png" }).success).toBe(true);
  });
  it(`at most ${LIMITS.cardsPerDeck} cards per deck`, () => {
    const card = { term: "a", definition: "b" };
    expect(cardsPutSchema.safeParse({ cards: Array(LIMITS.cardsPerDeck).fill(card) }).success).toBe(true);
    expect(cardsPutSchema.safeParse({ cards: Array(LIMITS.cardsPerDeck + 1).fill(card) }).success).toBe(false);
    expect(LIMITS.decksPerUser).toBe(200);
  });
});

describe("settings", () => {
  it("fills defaults and drops invalid stored values", () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = resolveSettings({ speechRate: 5, advanceAfter: 3, theme: "dark", bogus: 1 });
    expect(s.speechRate).toBe(0.9);
    expect(s.advanceAfter).toBe(1); // study pacing is fixed: stored values are ignored
    expect(s.theme).toBe("dark");
    expect("bogus" in s).toBe(false);
  });
});

describe("upload magic bytes", () => {
  it("detects webp, jpeg and png; rejects others", () => {
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });
});
