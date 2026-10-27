import type { Page } from "@playwright/test";
import { createDeckAPI, expect, registerAPI, setSettings, test, uid } from "./helpers";
import { answerQuestion } from "./study-helpers";

const WORDS = [
  { term: "sehr", definition: "very" },
  { term: "gut", definition: "good" },
  { term: "nicht", definition: "not" },
];
async function answerSentence(page: Page, texts: Record<string, string>, replies: Record<string, string>) {
  const q = page.getByTestId("question");
  const type = (await q.getAttribute("data-type"))!;
  const id = (await q.getAttribute("data-sentence-id"))!;
  const text = texts[id];
  if (process.env.SENTENCE_SHOTS) await page.screenshot({ path: `${process.env.SENTENCE_SHOTS}/${type}-${test.info().project.name}.png` });
  if (type === "fill_blank") {
    const blanked = (await page.getByTestId("blanked-sentence").textContent())!;
    const target = (await page.getByTestId("blank-context").count()) ? replies[id] : text;
    for (const opt of await page.getByTestId("blank-option").allTextContents()) {
      const word = opt.replace(/^\d/, "");
      if (blanked.replace("\u00a0", word) === target) {
        await page.getByTestId("blank-option").filter({ hasText: new RegExp(`^\\d${word}$`) }).click();
        break;
      }
    }
  } else if (type === "sentence_read") {
    await page.getByTestId("show-translation").click();
    await page.getByTestId("read-understood").click();
  } else if (type === "word_order") {
    for (const w of text.replace(/[.!?]+$/, "").split(/\s+/)) {
      await page.getByTestId("order-chunk").filter({ hasText: new RegExp(`^${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click();
    }
    await page.getByTestId("order-check").click();
  } else if (type === "qa_match" && (await page.getByTestId("qa-option").count())) {
    await page.getByTestId("qa-option").filter({ hasText: replies[id] }).click();
  } else if (type === "qa_match") {
    for (const pair of await page.getByTestId("qa-question").evaluateAll((els) => els.map((e) => e.getAttribute("data-pair")!))) {
      await page.locator(`[data-testid="qa-question"][data-pair="${pair}"]`).click();
      await page.locator(`[data-testid="qa-answer"][data-pair="${pair}"]`).click();
    }
  }
  await expect(page.getByTestId("feedback")).toHaveAttribute("data-correct", "true");
  if (process.env.SENTENCE_SHOTS) await page.screenshot({ path: `${process.env.SENTENCE_SHOTS}/${type}-answered-${test.info().project.name}.png` });
  await page.getByTestId("continue").click();
  return type;
}

test("sentences: import, locked until words are mastered, then fill-in → sentence → word order → Q&A", async ({ page }) => {
  await registerAPI(page, uid("Satz_"));
  // Whole ladder in one day so the test can finish words and sentences in one go.
  await setSettings(page, { soundEffects: false, stepsPerDay: 5 });
  const { deckId, cards } = await createDeckAPI(page, WORDS, { withImages: false });

  // Import sentences in the editor
  await page.goto(`/decks/${deckId}/edit`);
  await page.getByRole("button", { name: /Bulk import/ }).click();
  await page.getByTestId("import-tab-sentences").click();
  await page
    .getByLabel("Sentences to import")
    .fill("Mir geht's sehr gut. | I'm very well.\nWie geht's dir? | How are you? >> Mir geht's gut. | I'm fine.");
  await expect(page.getByTestId("sentence-import-preview")).toContainText("Mir geht's gut.");
  await page.getByRole("button", { name: "Add 2 sentences" }).click();
  const rows = page.getByTestId("sentence-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByTestId("sentence-words")).toHaveText("Words: sehr, gut");
  await page.getByTestId("save-deck").click();
  await expect(page).toHaveURL(new RegExp(`/decks/${deckId}$`), { timeout: 30_000 });

  // Locked until the words are mastered
  await expect(page.getByTestId("sentences-summary")).toHaveText("0/2 unlocked · 0 mastered");
  await expect(page.getByTestId("locked-sentence").first()).toContainText("needs: sehr, gut");

  // Learn the words (the example sentence is on the card back)
  await page.getByTestId("mode-learn").click();
  let sawExample = false;
  for (let step = 0; step < 60; step++) {
    if (await page.getByTestId("session-done").isVisible()) break;
    if (await page.getByTestId("round-summary").isVisible()) {
      await page.getByTestId("next-round").click();
      continue;
    }
    const q = page.getByTestId("question");
    await expect(q.or(page.getByTestId("round-summary")).or(page.getByTestId("session-done"))).toBeVisible();
    if (!(await q.isVisible())) continue;
    if (!sawExample && (await q.getAttribute("data-type")) === "flashcard" && (await q.getAttribute("data-card-id")) === cards[0].id) {
      await page.getByTestId("flashcard").click({ position: { x: 20, y: 20 } });
      await page.getByTestId("show-example").click();
      await expect(page.getByTestId("example")).toContainText("Mir geht's sehr gut.");
      await expect(page.getByTestId("example")).toContainText("I'm very well.");
      sawExample = true;
      await page.getByTestId("got-it").click();
      continue;
    }
    await answerQuestion(page, WORDS, cards, true);
  }
  expect(sawExample).toBe(true);
  await expect(page.getByTestId("session-done")).toBeVisible();

  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("count-mastered")).toHaveText("3");
  await expect(page.getByTestId("sentences-summary")).toHaveText("2/2 unlocked · 0 mastered");

  // Practise the sentences
  const sentences = (await (await page.request.get(`/api/decks/${deckId}`)).json()).sentences as { id: string; text: string; reply: string | null }[];
  const texts = Object.fromEntries(sentences.map((s) => [s.id, s.text]));
  const replies = Object.fromEntries(sentences.map((s) => [s.id, s.reply ?? ""]));
  await page.getByTestId("mode-sentences").click();
  const seen: Record<string, string[]> = {};
  for (let step = 0; step < 40; step++) {
    if (await page.getByTestId("session-done").isVisible()) break;
    if (await page.getByTestId("round-summary").isVisible()) {
      await page.getByTestId("next-round").click();
      continue;
    }
    const q = page.getByTestId("question");
    await expect(q.or(page.getByTestId("round-summary")).or(page.getByTestId("session-done"))).toBeVisible();
    if (!(await q.isVisible())) continue;
    const id = (await q.getAttribute("data-sentence-id"))!;
    const type = await answerSentence(page, texts, replies);
    seen[texts[id]] = [...(seen[texts[id]] ?? []), type];
  }
  expect(seen["Mir geht's sehr gut."]).toEqual(["fill_blank", "sentence_read", "word_order"]);
  expect(seen["Wie geht's dir?"]).toEqual(["fill_blank", "sentence_read", "word_order", "qa_match"]);
  await expect(page.getByTestId("day-stats")).toContainText("2 sentences mastered");

  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("sentences-summary")).toHaveText("2/2 unlocked · 2 mastered");
});
