import { expect, registerAPI, test, uid } from "./helpers";

// The page must never be wider than a phone screen (e.g. a hidden label escaping a scrollable table).
test("no page is wider than a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerAPI(page, uid("Narrow_"));
  const d = await page.request.post("/api/decks", { data: { title: "German test 1", termLang: "de-DE", definitionLang: "en-US" } });
  const deckId = (await d.json()).deck.id as string;
  const words = ["das Haus:the house", "der Hund:the dog", "die Zeitung:the newspaper", "das Buch:the book"].map((w) => {
    const [term, definition] = w.split(":");
    return { term, definition };
  });
  await page.request.put(`/api/decks/${deckId}/cards`, { data: { cards: words } });

  for (const path of ["/", `/decks/${deckId}`, `/decks/${deckId}/edit`, "/help", "/settings", "/review"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, `page width of ${path}`).toBeLessThanOrEqual(390);
  }
});
