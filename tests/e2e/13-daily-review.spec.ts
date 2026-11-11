import { createDeckAPI, expect, makeKnownAPI, registerAPI, setSettings, test, uid, WORDS } from "./helpers";
import { answerQuestion } from "./study-helpers";

test("daily review: known words only, a miss comes back once, finishing it starts the streak", async ({ page }) => {
  await registerAPI(page, uid("Daily_"));
  await setSettings(page, { soundEffects: false });
  const { cards } = await createDeckAPI(page, WORDS, { withImages: false });

  // No known words yet: the dashboard explains, and there's no streak.
  await page.goto("/");
  await expect(page.getByTestId("streak")).toContainText("0");
  await expect(page.getByTestId("daily-status")).toContainText("Starts once you’ve learned a few words");
  await expect(page.getByTestId("daily-start")).toHaveCount(0);

  const known = cards.slice(0, 4);
  await makeKnownAPI(page, known.map((c) => c.id));
  await page.reload();
  await expect(page.getByTestId("daily-status")).toContainText("4 words you know");
  await expect(page.getByTestId("week-strip").locator("[data-done=true]")).toHaveCount(0);
  await page.getByTestId("daily-start").click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByTestId("daily-chip")).toHaveText("Daily review");

  // Miss the first word, answer the rest; the missed one comes back once at the end.
  const asked: string[] = [];
  const first = await answerQuestion(page, WORDS, cards, false);
  asked.push(first.cardId);
  while ((await page.getByTestId("daily-done").count()) === 0) {
    const { cardId } = await answerQuestion(page, WORDS, cards, true);
    asked.push(cardId);
  }
  expect(asked).toHaveLength(5);
  expect(new Set(asked)).toEqual(new Set(known.map((c) => c.id)));
  expect(asked.at(-1)).toBe(first.cardId);

  const done = page.getByTestId("daily-done");
  await expect(done).toContainText("Daily review done!");
  await expect(page.getByTestId("daily-streak")).toContainText("1 day streak");
  await expect(page.getByTestId("week-strip").locator("[data-done=true]")).toHaveCount(1);

  // Keep reviewing: every known word already had its look today.
  await page.getByTestId("keep-reviewing").click();
  await expect(page.getByTestId("daily-done")).toContainText("You’ve reviewed everything for today");

  await page.goto("/");
  await expect(page.getByTestId("streak")).toContainText("1");
  await expect(page.getByTestId("daily-status")).toContainText("Done for today");
  await expect(page.getByTestId("daily-start")).toHaveText("Keep reviewing");
});
