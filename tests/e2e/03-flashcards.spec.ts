import { createDeckAPI, expect, registerAPI, test, uid, WORDS } from "./helpers";

test("flashcards: flip, audio, know / still learning, finish the round", async ({ page, isMobile }) => {
  await registerAPI(page, uid("Flash_"));
  const { deckId } = await createDeckAPI(page, WORDS);
  // Arrive by clicking (browsers only allow auto-played speech after a user gesture).
  await page.goto(`/decks/${deckId}`);
  await page.getByTestId("mode-flashcards").click();

  const card = page.getByTestId("flashcard");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("progress-text")).toHaveText("1 / 6");
  // Auto-play term
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tts: { lang: string }[] }).__tts.length)).toBeGreaterThan(0);

  await page.evaluate(() => ((window as unknown as { __tts: unknown[] }).__tts.length = 0));
  await page.getByRole("button", { name: "Play: la manzana" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __tts: { text: string; lang: string }[] }).__tts))
    .toContainEqual(expect.objectContaining({ text: "la manzana", lang: "es-ES" }));

  await card.click({ position: { x: 24, y: 24 } });
  await expect(card).toHaveAttribute("data-flipped", "true");
  await expect(page.getByTestId("flashcard-definition")).toHaveText("apple");

  // know, still learning, know, still learning, know, know
  const marks = [true, false, true, false, true, true];
  for (let i = 0; i < marks.length; i++) {
    await expect(page.getByTestId("progress-text")).toHaveText(`${i + 1} / 6`);
    if (isMobile) await page.getByTestId(marks[i] ? "know-it" : "still-learning").click();
    else await page.keyboard.press(marks[i] ? "ArrowRight" : "ArrowLeft");
    if (i < marks.length - 1) await expect(page.getByTestId("progress-text")).toHaveText(`${i + 2} / 6`);
  }
  const summary = page.getByTestId("flashcards-summary");
  await expect(summary).toContainText("4 known");
  await expect(summary).toContainText("2 still learning");
  await page.getByTestId("study-still-learning").click();
  await expect(page.getByTestId("progress-text")).toHaveText("1 / 2");
  await expect(page.getByTestId("flashcard-term")).toHaveText("el perro");

  // "Know it" counted as a review: the deck now has learning cards
  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("count-new")).toHaveText("0");
});
