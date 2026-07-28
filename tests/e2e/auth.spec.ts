import { expect, test } from "@playwright/test";

test.describe("Authentication foundation", () => {
  test("unauthenticated users are redirected to the login page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("the login page renders a single Google sign-in call to action", async ({ page }) => {
    await page.goto("/auth/login");

    // UI copy is in Spanish (see google-signin-button.tsx); the assertion
    // matches the actual rendered text shown to the user.
    const signInButton = page.getByRole("button", { name: /iniciar sesión con google/i });
    await expect(signInButton).toBeVisible();

    // Google OAuth is the only supported provider — assert no alternative
    // credential form (email/password) is rendered anywhere on the page.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("visiting an unknown route without a session redirects to login, not a 404", async ({
    page,
  }) => {
    await page.goto("/some/protected/route/that/does/not-exist-yet");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("the profile and admin routes require an authenticated session", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/auth\/login/);

    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("the auth-code-error page offers a way back to login", async ({ page }) => {
    await page.goto("/auth/auth-code-error");
    await expect(page.getByRole("heading", { name: /fallo al iniciar sesión/i })).toBeVisible();
    await page.getByRole("link", { name: /volver a intentarlo/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
