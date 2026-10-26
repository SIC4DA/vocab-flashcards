import { createDeckAPI, expect, registerUI, test, uid, WORDS } from "./helpers";

test("register, log out, log back in — decks are still there", async ({ page, allowConsole }) => {
  allowConsole(/status of 401/); // the deliberate failed login below
  const username = uid("Ana_");
  await registerUI(page, username);
  await expect(page.getByText("Create your first deck").first()).toBeVisible();
  await createDeckAPI(page, WORDS, { title: "My persistent deck" });

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  // Protected pages redirect to login with ?next
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);

  await page.getByLabel("Username").fill(username.toLowerCase());
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#form-error")).toHaveText("Invalid username or password");

  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goto("/");
  await expect(page.getByTestId("deck-card")).toHaveCount(1);
  await expect(page.getByTestId("deck-card")).toContainText("My persistent deck");
});

test("duplicate usernames are rejected case-insensitively", async ({ page, allowConsole }) => {
  allowConsole(/status of 409/);
  const username = uid("Dup_");
  await registerUI(page, username);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/register");
  await page.getByLabel("Username").fill(username.toUpperCase());
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByLabel("Confirm password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("That username is already taken")).toBeVisible();
});
