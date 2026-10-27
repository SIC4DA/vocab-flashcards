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
    { term: "Ich habe Hunger", definition: "I'm hungry" },
  ]);
  await page.goto(`/decks/${deckId}/study/flashcards`);
  await page.getByRole("button", { name: "Play: der Hund" }).click();
  // The article comes from the device voice, then the real recording of "Hund" plays.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __played: string[] }).__played))
    .toContain("https://upload.wikimedia.org/e2e/De-Hund.ogg.mp3");
  const tts = await page.evaluate(() => (window as unknown as { __tts: { text: string; lang: string }[] }).__tts);
  expect(tts).toContainEqual(expect.objectContaining({ text: "der", lang: "de-DE" }));

  // A sentence has no recording → the device voice reads it
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => ((window as unknown as { __tts: unknown[] }).__tts.length = 0));
  await page.getByRole("button", { name: "Play: Ich habe Hunger" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __tts: { text: string }[] }).__tts.map((t) => t.text)))
    .toContain("Ich habe Hunger");

  // Recordings can be switched off in Settings
  await page.goto("/settings");
  await expect(page.getByLabel("Use native-speaker recordings")).toBeChecked();
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

test("with a Gemini key: Organize with AI sets topics and removes pictures that don't help", async ({ page }) => {
  await registerAPI(page, uid("Organiser_"));
  const { deckId } = await germanDeck(page, [
    { term: "das Handtuch", definition: "towel" },
    { term: "die Wurst", definition: "sausage" },
    { term: "nachdenken", definition: "to reflect" },
  ]);
  // Pretend all three already had automatic pictures (as in decks made before this feature).
  const cards = (await (await page.request.get(`/api/decks/${deckId}`)).json()).cards as { id: string; term: string; definition: string }[];
  await page.request.put(`/api/decks/${deckId}/cards`, {
    data: { cards: cards.map((c, i) => ({ ...c, imageUrl: `https://images.e2e.test/thumb/${i}.png`, imageSource: "auto" })) },
  });
  expect((await page.request.put("/api/account/gemini-key", { data: { apiKey: VALID_KEY } })).status()).toBe(200);

  await page.goto(`/decks/${deckId}`);
  await page.getByTestId("organize-ai").click();
  await expect(page.getByTestId("toast")).toContainText("Deck organised");
  const row = (text: string) => page.getByTestId("card-table-row").filter({ hasText: text });
  await expect(row("to reflect").getByTestId("card-topic")).toHaveText("Everyday verbs");
  await expect(row("to reflect").locator("img")).toHaveCount(0);
  await expect(row("towel").getByTestId("card-topic")).toHaveText("Home");
  await expect(row("towel").locator("img")).toHaveCount(1);

  // In study mode, a word without a picture shows no empty image box
  await page.goto(`/decks/${deckId}/study/write`);
  for (let i = 0; i < 3; i++) {
    const def = await page.getByTestId("prompt-definition").textContent();
    const imgs = await page.getByTestId("question").locator("img").count();
    expect(imgs).toBe(def === "to reflect" ? 0 : 1);
    const term = cards.find((c) => c.definition === def)!.term;
    await page.getByTestId("answer-input").fill(term);
    await page.keyboard.press("Enter");
    await page.getByTestId("continue").click();
  }
});
