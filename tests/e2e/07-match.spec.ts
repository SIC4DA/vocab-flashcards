import { createDeckAPI, expect, registerAPI, setSettings, test, uid, WORDS } from "./helpers";

test("match game completes and the best time is saved", async ({ page }) => {
  await registerAPI(page, uid("Matcher_"));
  await setSettings(page, { soundEffects: false });
  const { deckId } = await createDeckAPI(page, WORDS);
  await page.goto(`/decks/${deckId}/study/match`);
  const tiles = page.getByTestId("match-tile");
  await expect(tiles).toHaveCount(12);

  // One wrong pair first (adds a penalty and flashes)
  const firstTerm = tiles.and(page.locator('[data-kind="term"]')).first();
  const termCard = await firstTerm.getAttribute("data-card-id");
  const wrongDef = page.locator(`[data-testid="match-tile"][data-kind="definition"]:not([data-card-id="${termCard}"])`).first();
  await firstTerm.click();
  await wrongDef.click();
  await expect(wrongDef).toHaveClass(/animate-shake/);
  await expect(wrongDef).not.toHaveClass(/animate-shake/);

  const ids = await page.locator('[data-testid="match-tile"][data-kind="term"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-card-id")!));
  for (const id of ids) {
    await page.locator(`[data-testid="match-tile"][data-kind="term"][data-card-id="${id}"]`).click();
    await page.locator(`[data-testid="match-tile"][data-kind="definition"][data-card-id="${id}"]`).click();
  }
  await expect(page.getByTestId("match-done")).toBeVisible();
  await expect(page.getByTestId("match-best")).toContainText("New best time");

  await page.goto(`/decks/${deckId}`);
  await expect(page.getByRole("region", { name: "Progress" }).getByText(/Best Match time:/)).toBeVisible();
});
