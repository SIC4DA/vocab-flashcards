import { expect, registerAPI, test, uid } from "./helpers";

const VALID_KEY = "AIzaE2EValidGeminiKey_1234567890";

test("each user adds their own Gemini key in Settings; without it the AI UI is hidden", async ({ page, allowConsole }) => {
  allowConsole(/status of 400/); // the deliberately wrong key below
  await registerAPI(page, uid("AIUser_"));
  expect((await (await page.request.get("/api/config")).json()).gemini).toBe(false);

  // Without a key: no Generate button (just a hint), no cloud-voice setting
  await page.goto("/decks/new");
  await expect(page.getByTestId("generate-toggle")).toHaveCount(0);
  await expect(page.getByTestId("generate-hint")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByTestId("gemini-status")).toHaveText("Not connected");
  await expect(page.getByText("Prefer cloud voice")).toHaveCount(0);

  // A key Google rejects shows an error
  await page.getByLabel("Your Gemini API key").fill("AIzaThisKeyIsNotValid_0000000000");
  await page.getByTestId("save-gemini-key").click();
  await expect(page.locator("#gemini-key-error")).toContainText("Google rejected this key");

  // A valid key connects
  await page.getByLabel("Your Gemini API key").fill(VALID_KEY);
  await page.getByTestId("save-gemini-key").click();
  await expect(page.getByTestId("gemini-status")).toHaveText("Connected · key …7890");
  await expect(page.getByText("Prefer cloud voice")).toBeVisible();
  expect((await (await page.request.get("/api/config")).json()).gemini).toBe(true);

  // Generate deck works with the user's key
  await page.goto("/decks/new");
  await page.getByLabel("Title").fill("Kitchen (AI)");
  await page.getByTestId("generate-toggle").click();
  await page.getByLabel("Topic").fill("kitchen items");
  await page.getByRole("spinbutton", { name: "Cards" }).fill("3");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const rows = page.getByTestId("card-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByLabel("Term", { exact: true })).toHaveValue("la cuchara");
  await expect(rows.nth(0).getByLabel("Definition", { exact: true })).toHaveValue("spoon");
  await rows.nth(2).getByLabel("Definition", { exact: true }).fill("dish / plate");

  // Auto-fill also uses Gemini now
  await page.getByRole("button", { name: "＋ Add card" }).click();
  await rows.nth(3).getByLabel("Term", { exact: true }).fill("el vaso");
  await rows.nth(3).getByRole("button", { name: /Auto-fill definition/ }).click();
  await expect(rows.nth(3).getByLabel("Definition", { exact: true })).toHaveValue("gemini meaning");

  await page.getByTestId("save-deck").click();
  await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("card-table-row")).toHaveCount(4);
  await expect(page.getByTestId("card-table-row").nth(2)).toContainText("dish / plate");

  // Removing the key turns AI features off again
  await page.goto("/settings");
  await page.getByTestId("remove-gemini-key").click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByTestId("gemini-status")).toHaveText("Not connected");
});

test("another user doesn't get someone else's key", async ({ page }) => {
  await registerAPI(page, uid("NoKey_"));
  await page.goto("/settings");
  await expect(page.getByTestId("gemini-status")).toHaveText("Not connected");
});

test("the in-app guide explains when a word is learned", async ({ page }) => {
  // Public page
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "How Vocab Flashcards works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /When is a word “learned”\?/ })).toBeVisible();
  await expect(page.getByText(/correct answers after you first see it/)).toBeVisible();

  // Personalised for a logged-in user, and linked from Settings
  await registerAPI(page, uid("Reader_"));
  await page.request.patch("/api/account/settings", { data: { advanceAfter: 3 } });
  await page.goto("/settings");
  await page.getByRole("link", { name: /How the app works/ }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByText("at least 15 correct answers")).toBeVisible();
});
