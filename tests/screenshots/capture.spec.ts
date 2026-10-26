import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const OUT = path.join(process.cwd(), "docs/screenshots");
const THUMB = fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/thumb.png"));
const WORDS = [
  { term: "la manzana", definition: "apple", example: "Me gusta la manzana roja." },
  { term: "el perro", definition: "dog", example: "El perro corre en el parque." },
  { term: "el gato", definition: "cat", example: "" },
  { term: "la casa", definition: "house", example: "" },
  { term: "el libro", definition: "book", example: "" },
  { term: "el café", definition: "coffee", example: "" },
];

test("capture screenshots of every page and study mode", async ({ page }, info) => {
  const w = info.project.name.replace("w", "");
  await page.route("https://images.e2e.test/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: THUMB }));
  const shot = async (name: string) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: false });
  };

  await page.goto("/");
  await shot("01-landing");
  await page.goto("/register");
  await shot("02-register");

  const username = `Shots${w}${Date.now().toString(36).slice(-4)}`;
  await page.request.post("/api/auth/register", { data: { username, password: "password123" } });
  await page.goto("/");
  await shot("03-dashboard-empty");

  const d = await page.request.post("/api/decks", { data: { title: "Spanish — Basics", description: "Everyday words", termLang: "es-ES", definitionLang: "en-US" } });
  const deckId = (await d.json()).deck.id;
  await page.request.put(`/api/decks/${deckId}/cards`, {
    data: { cards: WORDS.map((x, i) => ({ ...x, imageUrl: `https://images.e2e.test/thumb/${i}.png`, imageAttribution: "Photo by E2E, CC BY 4.0" })) },
  });
  await page.request.patch("/api/account/settings", { data: { autoPlayTerm: false, soundEffects: false } });

  await page.goto("/");
  await shot("04-dashboard");
  await page.goto(`/decks/${deckId}`);
  await shot("05-deck");
  await page.goto(`/decks/${deckId}/edit`);
  await shot("06-editor");

  await page.goto(`/decks/${deckId}/study/flashcards`);
  await page.getByTestId("flashcard").waitFor();
  await shot("07-flashcards-front");
  await page.getByTestId("flashcard").click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(700);
  await shot("08-flashcards-back");

  await page.goto(`/decks/${deckId}/study/learn`);
  await page.getByTestId("question").waitFor();
  await shot("09-learn-new-card");
  for (let i = 0; i < 6; i++) {
    await page.getByTestId("got-it").click();
    await page.getByTestId("got-it").click();
  }
  await page.getByTestId("next-round").click();
  await page.getByTestId("mc-option").first().waitFor();
  await shot("10-learn-multiple-choice");
  await page.getByTestId("mc-option").first().click();
  await shot("11-learn-feedback");

  await page.goto(`/decks/${deckId}/study/write`);
  await page.getByTestId("answer-input").waitFor();
  await shot("12-write");
  await page.goto(`/decks/${deckId}/study/listen`);
  await page.getByTestId("answer-input").waitFor();
  await shot("13-listen");
  await page.goto(`/decks/${deckId}/study/speak`);
  await page.waitForTimeout(800);
  await shot("14-speak");
  await page.goto(`/decks/${deckId}/study/match`);
  await page.getByTestId("match-grid").waitFor();
  await shot("15-match");
  await page.goto(`/decks/${deckId}/study/test`);
  await page.getByTestId("test-options").waitFor();
  await shot("16-test-options");
  await page.getByTestId("start-test").click();
  await page.getByTestId("test-question").first().waitFor();
  await shot("17-test");
  await page.getByTestId("submit-test").click();
  await page.getByTestId("test-results").waitFor();
  await shot("18-test-results");
  await page.goto("/review");
  await page.waitForTimeout(800);
  await shot("19-review");
  await page.goto("/settings");
  await shot("20-settings");
  await page.goto("/help");
  await shot("23-help");
  await page.goto("/help#learned");
  await shot("24-help-learned");
  await page.request.patch("/api/account/settings", { data: { theme: "dark" } });
  await page.goto(`/decks/${deckId}`);
  await shot("21-deck-dark");
  await page.goto(`/decks/${deckId}/study/flashcards`);
  await page.getByTestId("flashcard").waitFor();
  await shot("22-flashcards-dark");
});

test("real Chromium: TTS voices load and audio plays", async ({ page }, info) => {
  test.skip(info.project.name !== "w1280", "run once");
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const synth = window.speechSynthesis;
    const voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const v = synth.getVoices();
      if (v.length) return resolve(v);
      synth.addEventListener("voiceschanged", () => resolve(synth.getVoices()), { once: true });
      setTimeout(() => resolve(synth.getVoices()), 3000);
    });
    const es = voices.find((v) => v.lang.toLowerCase().startsWith("es"));
    const played = await new Promise<string>((resolve) => {
      const u = new SpeechSynthesisUtterance("la manzana");
      u.lang = "es-ES";
      if (es) u.voice = es;
      u.onstart = () => resolve("started");
      u.onerror = (e) => resolve(`error: ${(e as SpeechSynthesisErrorEvent).error}`);
      synth.speak(u);
      setTimeout(() => resolve(synth.speaking ? "speaking" : "no-start-event"), 4000);
    });
    return { voiceCount: voices.length, spanishVoice: es?.name ?? null, played };
  });
  fs.writeFileSync(path.join(OUT, "tts-smoke.json"), JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2));
  console.log("TTS smoke:", result);
  expect(result.voiceCount).toBeGreaterThan(0);
});
