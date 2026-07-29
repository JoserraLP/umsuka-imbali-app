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

/**
 * Tests for the OAuth callback route and the post-login redirect behaviour.
 *
 * Full login-flow tests (Google OAuth → callback → dashboard) require real
 * Supabase credentials and Google OAuth configuration, so they cannot run in
 * every environment. The tests below use two strategies:
 *
 *  1. **URL-driven error tests** — verify the callback route handles
 *     missing/invalid parameters gracefully by rendering the error page
 *     instead of crashing or leaking provider errors into the URL.
 *  2. **Session-injection tests** — when a valid Supabase session token is
 *     supplied via the `E2E_SESSION_TOKEN` environment variable, additional
 *     tests verify that authenticated users can access protected routes
 *     without bouncing back to the login page (i.e., no "double login").
 *
 *  To run the session-injection tests locally:
 *    1. Log in via the app UI in a normal browser.
 *    2. Open DevTools → Application → Cookies → localhost:3000.
 *    3. Copy the value of the `sb-<project-ref>-auth-token` cookie.
 *    4. Run: `E2E_SESSION_TOKEN=<value> npx playwright test`
 */
test.describe("OAuth callback error handling", () => {
  test("callback without 'code' parameter shows the generic auth-code-error page", async ({
    page,
  }) => {
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/auth\/auth-code-error/);
    await expect(page.getByRole("heading", { name: /fallo al iniciar sesión/i })).toBeVisible();
  });

  test("callback with 'code' but missing session exchange renders the error page", async ({
    page,
  }) => {
    // The callback will try to exchange this fake code; Supabase will reject
    // it (invalid_grant), which triggers the "exchange_failed" error path.
    await page.goto("/auth/callback?code=invalid-code-00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/auth\/auth-code-error/);
    await expect(page.getByRole("heading", { name: /fallo al iniciar sesión/i })).toBeVisible();
  });

  test("callback with provider error parameters shows the error page", async ({ page }) => {
    await page.goto(
      "/auth/callback?error=access_denied&error_description=El+usuario+cancel%c3%b3",
    );
    await expect(page).toHaveURL(/\/auth\/auth-code-error/);
    await expect(page.getByRole("heading", { name: /fallo al iniciar sesión/i })).toBeVisible();
  });

  test("the error page distinguishes provider errors from missing-code errors", async ({
    page,
  }) => {
    // Provider error
    await page.goto("/auth/callback?error=access_denied");
    await expect(page.getByText(/Google no pudo completar/i)).toBeVisible();

    // Missing code (no query string at all)
    await page.goto("/auth/auth-code-error?reason=missing_code");
    await expect(page.getByText(/no se recibi. el c.digo de autorizaci.n/i)).toBeVisible();

    // Exchange failure
    await page.goto("/auth/auth-code-error?reason=exchange_failed");
    await expect(page.getByText(/el servidor no pudo validar/i)).toBeVisible();
  });
});

/**
 * Session-injection tests that verify the "no double login" guarantee.
 *
 * These tests run ONLY when `E2E_SESSION_TOKEN` is set. They inject a real
 * Supabase session cookie before navigating, which simulates what the browser
 * would have after a successful OAuth callback.
 */
test.describe("Full login flow — no double login", () => {
  const sessionToken = process.env.E2E_SESSION_TOKEN;

  // Skip the entire suite when no token is available
  test.beforeAll(() => {
    test.skip(!sessionToken, "E2E_SESSION_TOKEN not set — skipping session-injection tests");
  });

  test("authenticated user can access the dashboard directly (no redirect to login)", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "sb-umsuka-auth-token", // placeholder — replaced by real cookie name below
        value: sessionToken!,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/dashboard");
    // Must land on dashboard, NOT be redirected back to /auth/login
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(/bienvenido/i)).toBeVisible();
  });

  test("authenticated user visiting /auth/login is redirected to dashboard", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "sb-umsuka-auth-token",
        value: sessionToken!,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/auth/login");
    // Must be redirected to dashboard immediately
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(/bienvenido/i)).toBeVisible();
  });

  test("session persists when navigating between protected routes", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "sb-umsuka-auth-token",
        value: sessionToken!,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    // Start at the dashboard
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");

    // Navigate to another protected route — should not redirect to login
    await page.goto("/profile");
    await expect(page).not.toHaveURL(/\/auth\/login/);
    // Profile page may redirect if there's an issue, but not to login
    await expect(page).not.toHaveURL("/auth/login");
  });

  test("no redirect loop when visiting the root path with an active session", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "sb-umsuka-auth-token",
        value: sessionToken!,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/");
    // Root should redirect to dashboard, not back to login
    await expect(page).toHaveURL("/dashboard");
    // Give it a moment — if there were a loop we'd see login
    await page.waitForTimeout(500);
    await expect(page).toHaveURL("/dashboard");
  });
});
