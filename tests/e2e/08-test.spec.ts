import type { Page } from "@playwright/test";
import { createDeckAPI, expect, registerAPI, setSettings, test, uid, WORDS } from "./helpers";

async function answerTest(page: Page, cards: { id: string; term: string; definition: string }[], wrongCount: number) {
  const questions = page.getByTestId("test-question");
  const n = await questions.count();
  let wrong = 0;
  const types: string[] = [];
  for (let i = 0; i < n; i++) {
    const q = questions.nth(i);
    const type = (await q.getAttribute("data-type"))!;
    types.push(type);
    const id = (await q.getAttribute("data-card-id"))!;
    const c = cards.find((x) => x.id === id)!;
    const makeWrong = wrong < wrongCount;
    if (makeWrong) wrong++;
    switch (type) {
      case "mc":
        if (makeWrong) await q.locator("label").filter({ hasNotText: c.definition }).first().getByRole("radio").check();
        else await q.getByRole("radio", { name: c.definition, exact: true }).check();
        break;
      case "true_false": {
        const shown = await q.locator("p").filter({ hasText: " means " }).textContent();
        const isMatch = shown!.trim().endsWith(` means ${c.definition}`);
        await q.getByTestId(isMatch !== makeWrong ? "test-tf-true" : "test-tf-false").check();
        break;
      }
      case "write":
      case "dictation":
        await q.getByTestId("test-input").fill(makeWrong ? "nope nope" : c.term);
        break;
    }
  }
  return { types, wrong };
}

test("test mode with all question types, pass/fail, and retake missed", async ({ page }) => {
  await registerAPI(page, uid("Tester_"));
  await setSettings(page, { soundEffects: false });
  const { deckId, cards } = await createDeckAPI(page, WORDS);
  await page.goto(`/decks/${deckId}/study/test`);

  await expect(page.getByTestId("test-options")).toBeVisible();
  await page.getByLabel(/Number of questions/).fill("6");
  for (const t of ["mc", "write", "dictation", "true_false"]) await page.getByTestId(`test-type-${t}`).check();
  await page.getByTestId("start-test").click();
  await expect(page.getByTestId("test-question")).toHaveCount(6);

  const { types, wrong } = await answerTest(page, cards, 2);
  expect(new Set(types)).toEqual(new Set(["mc", "write", "dictation", "true_false"]));
  await page.getByTestId("submit-test").click();
  await expect(page.getByTestId("test-results")).toBeVisible();
  await expect(page.getByTestId("test-score")).toHaveText(`${Math.round(((6 - wrong) / 6) * 100)}%`);
  await expect(page.getByTestId("test-verdict")).toContainText("Failed");
  await expect(page.locator('[data-testid="test-result-row"][data-correct="false"]')).toHaveCount(wrong);

  await page.getByTestId("retake-missed").click();
  await expect(page.getByTestId("test-question")).toHaveCount(wrong);
  await answerTest(page, cards, 0);
  await page.getByTestId("submit-test").click();
  await expect(page.getByTestId("test-score")).toHaveText("100%");
  await expect(page.getByTestId("test-verdict")).toContainText("Passed");
});
