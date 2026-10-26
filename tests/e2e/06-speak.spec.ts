import { createDeckAPI, expect, registerAPI, setSettings, test, uid, WORDS } from "./helpers";
import { currentWord, setSpeech } from "./study-helpers";

test("speak mode: right word passes, wrong word fails, permission denied falls back to Write", async ({ page }) => {
  await registerAPI(page, uid("Speaker_"));
  await setSettings(page, { soundEffects: false });
  const { deckId, cards } = await createDeckAPI(page, WORDS);
  await page.goto(`/decks/${deckId}/study/speak`);
  const q = page.getByTestId("question");

  // 1. Correct
  await expect(q).toHaveAttribute("data-type", "speak");
  let word = await currentWord(page, WORDS, cards);
  await setSpeech(page, "answer", word.term);
  await page.getByTestId("mic-button").click();
  await expect(page.getByTestId("feedback")).toHaveAttribute("data-correct", "true");
  await expect(page.getByTestId("heard")).toHaveText(word.term);
  await page.getByTestId("continue").click();

  // 2. Wrong word
  await expect(q).toHaveAttribute("data-type", "speak");
  word = await currentWord(page, WORDS, cards);
  await setSpeech(page, "wrong");
  await page.keyboard.press("m");
  await expect(page.getByTestId("feedback")).toHaveAttribute("data-correct", "false");
  await expect(page.getByTestId("heard")).toHaveText("zzz completely wrong");
  await expect(page.getByTestId("correct-answer")).toHaveText(word.term);
  await page.getByTestId("continue").click();

  // 3. Permission denied → explanation, question becomes Write for the rest of the session
  await expect(q).toHaveAttribute("data-type", "speak");
  word = await currentWord(page, WORDS, cards);
  await setSpeech(page, "denied");
  await page.getByTestId("mic-button").click();
  await expect(page.getByTestId("toast")).toContainText("Microphone access was denied");
  await expect(q).toHaveAttribute("data-type", "write");
  await page.getByTestId("answer-input").fill(word.term);
  await page.getByTestId("submit-answer").click();
  await expect(page.getByTestId("feedback")).toHaveAttribute("data-correct", "true");
  await page.getByTestId("continue").click();
  await expect(q).toHaveAttribute("data-type", "write");

  // "Skip — I can't speak now" turns the current question into Write without counting it wrong
  await page.goto(`/decks/${deckId}/study/speak`);
  await expect(q).toHaveAttribute("data-type", "speak");
  await page.getByTestId("skip-speak").click();
  await expect(q).toHaveAttribute("data-type", "write");
  await expect(page.getByTestId("feedback")).toHaveCount(0);
});
