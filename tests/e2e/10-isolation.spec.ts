import { createDeckAPI, expect, registerAPI, test, uid, WORDS } from "./helpers";

test("user B cannot open user A's deck URL (404)", async ({ page, browser, allowConsole }) => {
  allowConsole(/status of 404/);
  await registerAPI(page, uid("OwnerA_"));
  const { deckId, cards } = await createDeckAPI(page, WORDS);

  const ctxB = await browser.newContext({ baseURL: "http://localhost:3100" });
  const pageB = await ctxB.newPage();
  await registerAPI(pageB, uid("OtherB_"));
  for (const url of [`/decks/${deckId}`, `/decks/${deckId}/edit`, `/decks/${deckId}/study/learn`]) {
    const res = await pageB.goto(url);
    expect(res?.status(), url).toBe(404);
    await expect(pageB.getByTestId("not-found")).toBeVisible();
  }
  const api = await pageB.request.get(`/api/decks/${deckId}`);
  expect(api.status()).toBe(404);
  expect((await pageB.request.get(`/api/cards/${cards[0].id}/image`)).status()).toBe(404);
  await ctxB.close();

  // The owner still sees it
  const own = await page.goto(`/decks/${deckId}`);
  expect(own?.status()).toBe(200);
});
