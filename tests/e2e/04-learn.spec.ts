import { createDeckAPI, expect, registerAPI, setSettings, test, uid, WORDS } from "./helpers";
import { answerQuestion } from "./study-helpers";

const LEARN_WORDS = WORDS.slice(0, 4);

test("learn: ladder order MC → listening → dictation → write → Mastered, and wrong answers return", async ({ page }) => {
  await registerAPI(page, uid("Learner_"));
  // Allow the whole ladder in one day so the test can follow one word to Mastered.
  await setSettings(page, { advanceAfter: 1, roundSize: 5, stepsPerDay: 5, soundEffects: false });
  const { deckId, cards } = await createDeckAPI(page, LEARN_WORDS);
  const tracked = cards[0].id; // "la manzana" is first in the new-card order
  await page.goto(`/decks/${deckId}/study/learn`);

  const trackedTypes: string[] = [];
  let wrongCardId: string | null = null;
  let wrongReturned = false;
  let questionsSinceWrong = 0;

  for (let step = 0; step < 80; step++) {
    if (await page.getByTestId("session-done").isVisible()) break;
    if (await page.getByTestId("round-summary").isVisible()) {
      await page.getByTestId("next-round").click();
      continue;
    }
    const q = page.getByTestId("question");
    await expect(q.or(page.getByTestId("round-summary")).or(page.getByTestId("session-done"))).toBeVisible();
    if (!(await q.isVisible())) continue;
    const cardId = (await q.getAttribute("data-card-id"))!;
    const type = (await q.getAttribute("data-type"))!;

    // Answer one non-tracked multiple-choice question wrong, then expect that card back within 3–5 questions.
    // Only early in a round, so there are at least 3 questions left to come back after.
    const progress = (await page.getByTestId("progress-text").textContent()) ?? "";
    const roundStart = /^[01] \//.test(progress);
    const answerWrong = !wrongCardId && roundStart && cardId !== tracked && type === "mc";
    if (wrongCardId && !wrongReturned) {
      questionsSinceWrong++;
      if (cardId === wrongCardId) {
        wrongReturned = true;
        expect(questionsSinceWrong).toBeGreaterThanOrEqual(3);
        expect(questionsSinceWrong).toBeLessThanOrEqual(5);
      }
    }
    await answerQuestion(page, LEARN_WORDS, cards, !answerWrong);
    if (answerWrong) wrongCardId = cardId;
    if (cardId === tracked) {
      trackedTypes.push(type);
      if (type === "write") break;
    }
  }

  expect(trackedTypes).toEqual(["flashcard", "mc", "listen_mc", "dictation", "write"]);
  expect(wrongCardId).not.toBeNull();
  expect(wrongReturned).toBe(true);

  await page.goto(`/decks/${deckId}`);
  const row = page.getByTestId("card-table-row").filter({ hasText: "la manzana" });
  await expect(row.getByTestId("card-stage")).toHaveText("Mastered");
  await expect(page.getByTestId("count-mastered")).not.toHaveText("0");
});

test("speaking practice is gone: no Speak mode, no speaking settings", async ({ page, allowConsole }) => {
  allowConsole(/status of 404/);
  await registerAPI(page, uid("NoSpeak_"));
  const { deckId } = await createDeckAPI(page, LEARN_WORDS);
  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("mode-learn")).toBeVisible();
  await expect(page.getByTestId("mode-speak")).toHaveCount(0);
  expect((await page.goto(`/decks/${deckId}/study/speak`))?.status()).toBe(404);
  await page.goto("/settings");
  await expect(page.getByText(/speaking questions/i)).toHaveCount(0);
});

test("daily session: finite, ends with 'Done for today', topics on the deck page, keep going", async ({ page }) => {
  await registerAPI(page, uid("Daily_"));
  await setSettings(page, { soundEffects: false }); // defaults: 1 correct per step, 2 steps per word per day
  const { deckId, cards } = await createDeckAPI(page, LEARN_WORDS);
  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("topic-row")).toHaveCount(1);
  await expect(page.getByTestId("topic-row").first()).toContainText("Set 1");
  await expect(page.getByTestId("topic-row").first()).toHaveAttribute("data-current", "true");
  await page.getByTestId("mode-learn").click();

  let questions = 0;
  const seen = new Map<string, string[]>();
  for (let step = 0; step < 40; step++) {
    if (await page.getByTestId("session-done").isVisible()) break;
    if (await page.getByTestId("round-summary").isVisible()) {
      await page.getByTestId("next-round").click();
      continue;
    }
    const q = page.getByTestId("question");
    await expect(q.or(page.getByTestId("round-summary")).or(page.getByTestId("session-done"))).toBeVisible();
    if (!(await q.isVisible())) continue;
    const { type, cardId } = await answerQuestion(page, LEARN_WORDS, cards, true);
    seen.set(cardId, [...(seen.get(cardId) ?? []), type]);
    questions++;
  }
  await expect(page.getByTestId("session-done")).toContainText("Done for today!");
  await expect(page.getByTestId("day-stats")).toContainText("4 words practised");
  // Each new word: see it, multiple choice, listening — then it rests until tomorrow.
  expect(questions).toBe(12);
  for (const types of seen.values()) expect(types).toEqual(["flashcard", "mc", "listen_mc"]);

  // Optional bonus session: one more step per word
  await page.getByTestId("keep-going").click();
  await expect(page.getByTestId("question")).toHaveAttribute("data-type", "dictation");

  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("topic-row").first()).toContainText("0 new");
});
