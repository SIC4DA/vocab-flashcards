import { createDeckAPI, expect, registerAPI, setSettings, test, uid } from "./helpers";

const NOUNS = [
  { term: "Hund", definition: "dog", article: "der", plural: "Hunde" },
  { term: "Buch", definition: "book", article: "das", plural: "Bücher" },
  { term: "Zeitung", definition: "newspaper", article: "die", plural: "Zeitungen" },
];

test("articles & plurals: look them up, play a round with a tip and a retry, then type the plurals", async ({ page }) => {
  await registerAPI(page, uid("Grammar_"));
  await setSettings(page, { soundEffects: false });
  const { deckId, cards } = await createDeckAPI(
    page,
    NOUNS.map(({ term, definition }) => ({ term, definition })),
    { termLang: "de-DE", title: "Deutsch", withImages: false },
  );
  const nounFor = (cardId: string) => NOUNS[cards.findIndex((c) => c.id === cardId)];

  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("mode-grammar")).toContainText("der, die, das and plurals");
  await page.getByTestId("mode-grammar").click();

  // Nothing known yet: look the nouns up (German Wiktionary).
  await page.getByTestId("grammar-lookup").click();
  // Found, but not met in Learn yet: the game waits for them.
  await expect(page.getByTestId("grammar-not-seen")).toContainText("3 nouns");

  // Flashcards show the article in its gender colour, and the plural on the back.
  await page.goto(`/decks/${deckId}/study/flashcards`);
  await expect(page.getByTestId("flashcard-term").first()).toHaveText("der Hund");
  await expect(page.getByTestId("flashcard-term").first().locator("[data-gender=m]")).toHaveText("der");
  await page.getByTestId("flashcard").first().click();
  await expect(page.getByTestId("noun-forms").first()).toHaveText("der Hund · die Hunde");

  // Writing a noun: the article is part of the word.
  await page.goto(`/decks/${deckId}/study/write`);
  const first = nounFor((await page.getByTestId("question").getAttribute("data-card-id"))!);
  await page.getByTestId("answer-input").fill(first.term);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("feedback")).toHaveAttribute("data-correct", "false");
  await expect(page.getByTestId("feedback")).toContainText("the article is part of the word");
  await expect(page.getByTestId("correct-answer")).toHaveText(`${first.article} ${first.term}`);
  await expect(page.getByTestId("term-plural")).toContainText(`die ${first.plural}`);

  // Meet them in Learn (first view), then play.
  for (const c of cards) {
    await page.request.post("/api/review", { data: { cardId: c.id, mode: "learn", questionType: "flashcard", correct: true } });
  }
  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("mode-grammar")).toContainText("3 nouns ready");
  await page.getByTestId("mode-grammar").click();
  const q = page.getByTestId("grammar-question");
  await expect(q).toBeVisible();

  let missed = false;
  const seen: string[] = [];
  while ((await page.getByTestId("grammar-score").count()) === 0) {
    await expect(q).toBeVisible();
    const kind = (await q.getAttribute("data-kind"))!;
    const noun = nounFor((await q.getAttribute("data-card-id"))!);
    seen.push(`${noun.term}:${kind}`);
    const answer = kind === "article" ? noun.article : noun.plural;
    const options = page.getByTestId("grammar-option");
    const exact = new RegExp(`(^|\\s|die)${answer}$`);
    if (kind === "article" && noun.term === "Zeitung" && !missed) {
      // Miss "die Zeitung" once: the tip explains -ung, and it comes back at the end.
      missed = true;
      await options.filter({ hasText: /der$/ }).click();
      await expect(page.getByTestId("grammar-feedback")).toHaveAttribute("data-correct", "false");
      await expect(page.getByTestId("grammar-tip")).toContainText("-ung");
      await expect(page.getByTestId("grammar-full")).toHaveText("die Zeitung → die Zeitungen");
    } else {
      expect(kind).not.toBe("plural_write");
      await options.filter({ hasText: exact }).click();
      await expect(page.getByTestId("grammar-feedback")).toHaveAttribute("data-correct", "true");
    }
    await page.getByTestId("grammar-continue").click();
  }
  expect(seen).toHaveLength(7);
  expect(seen.at(-1)).toBe("Zeitung:article");
  await expect(page.getByTestId("grammar-score-text")).toContainText("5/6");
  await expect(page.getByTestId("grammar-score")).toContainText("die Zeitung → die Zeitungen");

  // Second round: plurals already picked right are now typed — umlauts count.
  await page.getByTestId("grammar-again").click();
  let typedWrong = false;
  while ((await page.getByTestId("grammar-score").count()) === 0) {
    await expect(q).toBeVisible();
    const kind = (await q.getAttribute("data-kind"))!;
    const noun = nounFor((await q.getAttribute("data-card-id"))!);
    if (kind === "article") {
      await page.getByTestId("grammar-option").filter({ hasText: new RegExp(`${noun.article}$`) }).click();
    } else {
      expect(kind).toBe("plural_write");
      if (noun.term === "Buch" && !typedWrong) {
        typedWrong = true;
        await page.getByTestId("plural-input").fill("Bucher");
        await page.getByTestId("plural-submit").click();
        await expect(page.getByTestId("grammar-feedback")).toHaveAttribute("data-correct", "false");
        await expect(page.getByTestId("grammar-feedback")).toContainText("You wrote Bucher");
      } else {
        await page.getByTestId("plural-input").fill(noun.plural);
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("grammar-feedback")).toHaveAttribute("data-correct", "true");
      }
    }
    await page.getByTestId("grammar-continue").click();
  }
  expect(typedWrong).toBe(true);

  // The deck page and editor show what was found.
  await page.goto(`/decks/${deckId}`);
  await expect(page.getByTestId("card-plural").first()).toContainText("pl.");
  await page.goto(`/decks/${deckId}/edit`);
  await expect(page.getByTestId("plural-field").first()).toHaveValue("Hunde");
  await expect(page.getByTestId("article-select").first()).toHaveValue("der");
});
