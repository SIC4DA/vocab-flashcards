import { expect, registerAPI, test, uid, WORDS } from "./helpers";

test("create a Spanish→English deck with auto images, then bulk-import 4 more", async ({ page }) => {
  await registerAPI(page, uid("Creator_"));
  await page.goto("/decks/new");
  await page.getByLabel("Title").fill("Spanish — Basics");
  await expect(page.getByLabel(/Term language/)).toHaveValue(/Spanish \(Spain\)/);
  await expect(page.getByLabel(/Definition language/)).toHaveValue(/English \(US\)/);

  const rows = page.getByTestId("card-row");
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < WORDS.length; i++) {
    if (i >= 3) {
      // Tab from the last field adds a new row (Quizlet-style)
      await rows.nth(i - 1).getByLabel("Example").focus();
      await page.keyboard.press("Tab");
      await expect(rows).toHaveCount(i + 1);
      await expect(rows.nth(i).getByLabel("Term", { exact: true })).toBeFocused();
    }
    await rows.nth(i).getByLabel("Term", { exact: true }).fill(WORDS[i].term);
    await rows.nth(i).getByLabel("Definition", { exact: true }).fill(WORDS[i].definition);
  }

  // Auto-fill suggests a definition (mocked MyMemory)
  await page.getByRole("button", { name: "Add card" }).click();
  await rows.nth(6).getByLabel("Term", { exact: true }).fill("la mesa");
  await rows.nth(6).getByRole("button", { name: /Auto-fill definition/ }).click();
  await expect(rows.nth(6).getByLabel("Definition", { exact: true })).toHaveValue("meaning of la mesa");
  await rows.nth(6).getByRole("button", { name: /Delete card 7/ }).click();
  await expect(rows).toHaveCount(6);

  await page.getByTestId("save-deck").click();
  await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("deck-title")).toHaveText("Spanish — Basics");
  const tableRows = page.getByTestId("card-table-row");
  await expect(tableRows).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    await expect(tableRows.nth(i).locator("img")).toHaveAttribute("src", /^https:\/\/images\.e2e\.test\/thumb\//);
  }

  // Bulk import
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByRole("button", { name: /Bulk import/ }).click();
  await page.getByLabel("Cards to import").fill("la silla\tchair\nla puerta, door\nla ventana - window\nthis line is bad\nel coche - car");
  const preview = page.getByTestId("import-preview");
  await expect(preview).toContainText("chair");
  await expect(preview).toContainText("No delimiter found");
  await page.getByRole("button", { name: "Add 4 cards" }).click();
  await expect(page.getByTestId("card-row")).toHaveCount(10);
  await page.getByTestId("save-deck").click();
  await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("card-table-row")).toHaveCount(10);
  await expect(page.getByTestId("card-table-row").nth(9).locator("img")).toHaveAttribute("src", /images\.e2e\.test/);

  await page.goto("/");
  await expect(page.getByTestId("deck-card")).toContainText("10 cards");
});
