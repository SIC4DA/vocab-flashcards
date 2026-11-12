import { expect, registerAPI, test, uid } from "./helpers";

const VALID_KEY = "AQ.Ab8RN6E2EValidGeminiKey_1234567890";

async function germanDeck(page: import("@playwright/test").Page, words: { term: string; definition: string }[]) {
  const d = await page.request.post("/api/decks", { data: { title: "Deutsch", termLang: "de-DE", definitionLang: "en-US" } });
  const deckId = (await d.json()).deck.id as string;
  const r = await page.request.put(`/api/decks/${deckId}/cards`, { data: { cards: words } });
  return { deckId, cards: (await r.json()).cards as { id: string; term: string }[] };
}

test("pronunciation uses a native-speaker recording when one exists", async ({ page }) => {
  await registerAPI(page, uid("Hoerer_"));
  const { deckId } = await germanDeck(page, [
    { term: "der Hund", definition: "dog" },
    { term: "das Buch", definition: "book" },
    { term: "Ich habe Hunger", definition: "I'm hungry" },
  ]);
  await page.goto(`/decks/${deckId}/study/flashcards`);
  const played = () => page.evaluate(() => (window as unknown as { __played: string[] }).__played);
  const tts = () => page.evaluate(() => (window as unknown as { __tts: { text: string; lang: string }[] }).__tts);
  await page.getByRole("button", { name: "Play: der Hund" }).click();
  // The article has its own native recording: "der", then "Hund", both real recordings.
  await expect.poll(played).toContain("https://upload.wikimedia.org/e2e/De-Hund.ogg.mp3");
  const order = await played();
  expect(order.indexOf("https://upload.wikimedia.org/e2e/De-der.ogg.mp3")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("https://upload.wikimedia.org/e2e/De-der.ogg.mp3")).toBeLessThan(order.indexOf("https://upload.wikimedia.org/e2e/De-Hund.ogg.mp3"));
  expect((await tts()).map((t) => t.text)).not.toContain("der");

  // No recording of "das" in this mock: the device voice says the article, then the recording of "Buch" plays.
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Play: das Buch" }).click();
  await expect.poll(played).toContain("https://upload.wikimedia.org/e2e/De-Buch.ogg.mp3");
  expect(await tts()).toContainEqual(expect.objectContaining({ text: "das", lang: "de-DE" }));

  // A sentence has no recording → the device voice reads it
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => ((window as unknown as { __tts: unknown[] }).__tts.length = 0));
  await page.getByRole("button", { name: "Play: Ich habe Hunger" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __tts: { text: string }[] }).__tts.map((t) => t.text)))
    .toContain("Ich habe Hunger");

  // Recordings are always used: there's no setting to turn them off.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Audio" })).toBeVisible();
  await expect(page.getByText("Use native-speaker recordings")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Studying" })).toHaveCount(0);
});

test("without AI, verbs like 'to spell' get no picture", async ({ page }) => {
  await registerAPI(page, uid("NoPic_"));
  await page.goto("/decks/new");
  await page.getByLabel("Title").fill("Deutsch");
  await page.getByLabel(/Term language/).click();
  await page.getByLabel(/Term language/).fill("German");
  await page.getByRole("option", { name: /German/ }).click();
  const rows = page.getByTestId("card-row");
  await rows.nth(0).getByLabel("Term", { exact: true }).fill("das Handtuch");
  await rows.nth(0).getByLabel("Definition", { exact: true }).fill("towel");
  await rows.nth(1).getByLabel("Term", { exact: true }).fill("buchstabieren");
  await rows.nth(1).getByLabel("Definition", { exact: true }).fill("to spell");
  await page.getByTestId("save-deck").click();
  await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const table = page.getByTestId("card-table-row");
  await expect(table.filter({ hasText: "towel" }).locator("img")).toHaveAttribute("src", /images\.e2e\.test/);
  await expect(table.filter({ hasText: "to spell" }).locator("img")).toHaveCount(0);
  await expect(table.filter({ hasText: "to spell" }).getByTitle("No picture needed")).toBeVisible();
});

test("no Organize with AI; a word without a picture shows no empty image box", async ({ page }) => {
  await registerAPI(page, uid("NoBox_"));
  const { deckId, cards } = await germanDeck(page, [
    { term: "das Handtuch", definition: "towel" },
    { term: "die Wurst", definition: "sausage" },
    { term: "nachdenken", definition: "to reflect" },
  ]);
  await page.request.put(`/api/decks/${deckId}/cards`, {
    data: {
      cards: cards.map((c, i) =>
        c.term === "nachdenken"
          ? { ...c, imageUrl: null, noImage: true }
          : { ...c, imageUrl: `https://images.e2e.test/thumb/${i}.png`, imageSource: "auto" },
      ),
    },
  });
  expect((await page.request.put("/api/account/gemini-key", { data: { apiKey: VALID_KEY } })).status()).toBe(200);

  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("deck-title")).toBeVisible();
  await expect(page.getByText("Organize with AI")).toHaveCount(0);
  await page.getByTestId("deck-menu").click();
  await expect(page.getByRole("menuitem")).toHaveText(["Duplicate", "Export CSV", "Reset progress", "Delete deck"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.goto(`/decks/${deckId}/study/write`);
  for (let i = 0; i < 3; i++) {
    const def = await page.getByTestId("prompt-definition").textContent();
    const imgs = await page.getByTestId("question").locator("img").count();
    expect(imgs).toBe(def === "to reflect" ? 0 : 1);
    const term = cards.find((c) => (c as unknown as { definition: string }).definition === def)!.term;
    await page.getByTestId("answer-input").fill(term);
    await page.keyboard.press("Enter");
    await page.getByTestId("continue").click();
  }
});
