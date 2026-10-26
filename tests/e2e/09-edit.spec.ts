import path from "node:path";
import { createDeckAPI, expect, registerAPI, test, uid, WORDS } from "./helpers";

test("edit deck: reorder, delete with undo, upload image, save, reload, persisted", async ({ page }) => {
  await registerAPI(page, uid("Editor_"));
  const words = WORDS.slice(0, 4);
  const { deckId } = await createDeckAPI(page, words, { withImages: false });
  await page.goto(`/decks/${deckId}/edit`);
  const rows = page.getByTestId("card-row");
  await expect(rows).toHaveCount(4);

  // Reorder: move card 1 down → [perro, manzana, gato, casa]
  await page.getByRole("button", { name: "Move card 1 down" }).click();
  await expect(rows.nth(0).getByLabel("Term", { exact: true })).toHaveValue("el perro");
  await expect(rows.nth(1).getByLabel("Term", { exact: true })).toHaveValue("la manzana");

  // Delete card 3 and undo
  await page.getByRole("button", { name: "Delete card 3" }).click();
  await expect(rows).toHaveCount(3);
  await page.getByTestId("toast").getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(2).getByLabel("Term", { exact: true })).toHaveValue("el gato");

  // Delete card 4 for real
  await page.getByRole("button", { name: "Delete card 4" }).click();
  await expect(rows).toHaveCount(3);

  // Upload an image for the first card (resized + WebP-encoded in the browser)
  await rows.nth(0).getByTestId("image-upload-input").setInputFiles(path.join(__dirname, "fixtures/upload.png"));
  await expect(rows.nth(0).getByTestId("image-slot").locator("img")).toHaveAttribute("src", /^blob:/);

  await page.getByTestId("save-deck").click();
  await expect(page).toHaveURL(new RegExp(`/decks/${deckId}$`), { timeout: 30_000 });

  await page.goto(`/decks/${deckId}/edit`);
  await page.reload();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByLabel("Term", { exact: true })).toHaveValue("el perro");
  await expect(rows.nth(1).getByLabel("Term", { exact: true })).toHaveValue("la manzana");
  await expect(rows.nth(2).getByLabel("Term", { exact: true })).toHaveValue("el gato");
  const uploaded = rows.nth(0).getByTestId("image-slot").locator("img");
  await expect(uploaded).toHaveAttribute("src", /^\/api\/cards\/[0-9a-f-]{36}\/image\?v=\d+$/);
  // The uploaded image is actually served (and decodes)
  await expect.poll(() => uploaded.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const width = await uploaded.evaluate((img: HTMLImageElement) => Math.max(img.naturalWidth, img.naturalHeight));
  expect(width).toBeLessThanOrEqual(512);
  // Cards without images got one automatically on save
  await expect(rows.nth(1).getByTestId("image-slot").locator("img")).toHaveAttribute("src", /images\.e2e\.test/);
});

test("unsaved changes trigger a warning before leaving", async ({ page }) => {
  await registerAPI(page, uid("Leaver_"));
  const { deckId } = await createDeckAPI(page, WORDS.slice(0, 2));
  await page.goto(`/decks/${deckId}/edit`);
  await page.getByTestId("card-row").nth(0).getByLabel("Term", { exact: true }).fill("changed");
  let asked = false;
  page.once("dialog", async (d) => {
    asked = d.message().includes("unsaved changes");
    await d.dismiss();
  });
  await page.getByRole("link", { name: "Cancel" }).click();
  expect(asked).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/decks/${deckId}/edit$`));
});
