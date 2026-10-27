import { createDeckAPI, expect, registerAPI, setSettings, test, uid, WORDS } from "./helpers";
import { currentWord } from "./study-helpers";

test("write mode: accent-insensitive answer and typo override with 'I was right'", async ({ page }) => {
  await registerAPI(page, uid("Writer_"));
  await setSettings(page, { soundEffects: false });
  const { deckId, cards } = await createDeckAPI(page, WORDS);
  await page.goto(`/decks/${deckId}/study/write`);

  const seen = new Set<string>();
  for (let i = 0; i < WORDS.length; i++) {
    const word = await currentWord(page, WORDS, cards);
    seen.add(word.term);
    const input = page.getByTestId("answer-input");
    let expectCorrect = true;
    if (word.term === "el café") {
      // Use the on-screen special-character bar for one character, then drop the accent elsewhere
      await input.fill("el cafe");
    } else if (word.term === "la manzana") {
      await input.fill("la manzena");
      expectCorrect = false;
    } else {
      await input.fill(word.term);
    }
    await page.keyboard.press("Enter");
    const fb = page.getByTestId("feedback");
    await expect(fb).toBeVisible();
    await expect(fb).toHaveAttribute("data-correct", String(expectCorrect));
    if (word.term === "el café") {
      await expect(fb).toContainText("Almost — watch the accents");
      await expect(page.getByTestId("correct-answer")).toHaveText("el café");
    }
    if (word.term === "la manzana") {
      await expect(fb).toContainText("Almost right");
      await page.getByTestId("override").click();
      await expect(fb).toHaveAttribute("data-correct", "true");
      await expect(page.getByTestId("override")).toHaveCount(0);
    }
    await page.keyboard.press("Enter");
  }
  expect(seen.size).toBe(WORDS.length);
  await expect(page.getByTestId("session-done")).toContainText("6 of 6 answers correct");

  // Special characters bar inserts at the cursor
  await page.goto(`/decks/${deckId}/study/write`);
  const input = page.getByTestId("answer-input");
  await input.fill("caf");
  await page.getByRole("button", { name: "Insert é" }).click();
  await expect(input).toHaveValue("café");
});

test("no audio is replayed after answering (multiple choice or writing)", async ({ page }) => {
  await registerAPI(page, uid("Quiet_"));
  await setSettings(page, { soundEffects: false });
  const { deckId, cards } = await createDeckAPI(page, WORDS);
  const spoken = () => page.evaluate(() => (window as unknown as { __tts: unknown[] }).__tts.length);
  const played = () => page.evaluate(() => (window as unknown as { __played: unknown[] }).__played.length);

  // Writing: submit right and wrong answers — nothing is spoken afterwards
  await page.goto(`/decks/${deckId}/study/write`);
  for (const correct of [true, false]) {
    const word = await currentWord(page, WORDS, cards);
    const [t0, p0] = [await spoken(), await played()];
    await page.getByTestId("answer-input").fill(correct ? word.term : "zzzz");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("feedback")).toBeVisible();
    await page.waitForTimeout(600);
    expect(await spoken()).toBe(t0);
    expect(await played()).toBe(p0);
    await page.getByTestId("continue").click();
  }

  // Multiple choice in Learn (fresh deck): the word is heard when the question appears, not again after picking
  const fresh = await createDeckAPI(page, WORDS);
  await page.goto(`/decks/${fresh.deckId}`);
  await page.getByTestId("mode-learn").click();
  for (let i = 0; i < 6; i++) {
    await page.getByTestId("got-it").click();
    await page.getByTestId("got-it").click();
  }
  await page.getByTestId("next-round").click();
  await expect(page.getByTestId("question")).toHaveAttribute("data-type", "mc");
  await expect.poll(spoken).toBeGreaterThan(0); // auto-play when the card appears
  await page.waitForTimeout(300);
  const [t0, p0] = [await spoken(), await played()];
  await page.getByTestId("mc-option").first().click();
  await expect(page.getByTestId("feedback")).toBeVisible();
  await page.waitForTimeout(600);
  expect(await spoken()).toBe(t0);
  expect(await played()).toBe(p0);
});
