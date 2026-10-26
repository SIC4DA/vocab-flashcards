import type { Page } from "@playwright/test";
import { expect, type Word } from "./helpers";

export async function lastSpokenTerm(page: Page, lang = "es-ES"): Promise<string> {
  await expect
    .poll(() => page.evaluate((l) => (window as unknown as { __tts: { lang: string }[] }).__tts.some((t) => t.lang === l), lang))
    .toBe(true);
  return page.evaluate(
    (l) => [...(window as unknown as { __tts: { text: string; lang: string }[] }).__tts].reverse().find((t) => t.lang === l)!.text,
    lang,
  );
}

export async function setSpeech(page: Page, mode: "answer" | "wrong" | "denied", answer = "") {
  await page.evaluate(([m, a]) => ((window as unknown as { __speech: unknown }).__speech = { mode: m, answer: a }), [mode, answer]);
}

export async function clearSpoken(page: Page) {
  await page.evaluate(() => ((window as unknown as { __tts: unknown[] }).__tts.length = 0));
}

/** Work out the term the current question is about from what is shown (or spoken). */
export async function currentWord(page: Page, words: Word[], cards: { id: string; term: string }[]): Promise<Word> {
  const id = await page.getByTestId("question").getAttribute("data-card-id");
  const term = cards.find((c) => c.id === id)!.term;
  return words.find((w) => w.term === term)!;
}

/**
 * Answer the visible question. Returns its type and card id.
 * `correct=false` deliberately answers wrong.
 */
export async function answerQuestion(
  page: Page,
  words: Word[],
  cards: { id: string; term: string }[],
  correct = true,
): Promise<{ type: string; cardId: string }> {
  const q = page.getByTestId("question");
  await expect(q).toBeVisible();
  const type = (await q.getAttribute("data-type"))!;
  const cardId = (await q.getAttribute("data-card-id"))!;
  const word = await currentWord(page, words, cards);
  switch (type) {
    case "flashcard":
      await page.getByTestId("got-it").click();
      await expect(page.getByTestId("got-it")).toHaveText(/Got it/);
      await page.getByTestId("got-it").click();
      await waitForNext(page, cardId);
      return { type, cardId };
    case "mc":
    case "mc_reverse":
    case "listen_mc": {
      const answer = type === "mc" ? word.definition : word.term;
      const options = page.getByTestId("mc-option");
      if (correct) await options.filter({ hasText: new RegExp(`^\\d?${escapeRe(answer)}$`) }).click();
      else await options.filter({ hasNotText: new RegExp(`^\\d?${escapeRe(answer)}$`) }).first().click();
      break;
    }
    case "dictation":
    case "write":
      await page.getByTestId("answer-input").fill(correct ? word.term : "zzzz");
      await page.getByTestId("submit-answer").click();
      break;
    case "speak":
      await setSpeech(page, correct ? "answer" : "wrong", word.term);
      await page.getByTestId("mic-button").click();
      break;
  }
  const fb = page.getByTestId("feedback");
  await expect(fb).toBeVisible();
  await expect(fb).toHaveAttribute("data-correct", String(correct));
  await page.getByTestId("continue").click();
  await waitForNext(page, cardId);
  return { type, cardId };
}

/** Wait until the question for `cardId` has been replaced (or the round/session ended). */
async function waitForNext(page: Page, cardId: string) {
  await expect
    .poll(async () => {
      const q = page.getByTestId("question");
      if ((await q.count()) === 0) return true;
      return (await q.getAttribute("data-card-id")) !== cardId || (await page.getByTestId("feedback").count()) === 0;
    })
    .toBe(true);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
