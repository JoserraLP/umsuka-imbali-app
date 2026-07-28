interface CookieOptions {
  path?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  httpOnly?: boolean;
}

/**
 * `secure` is derived from NODE_ENV rather than left to the library's
 * default: Vercel production is always HTTPS, local dev is always HTTP.
 * Leaving `secure` unset/true in local dev is a classic cause of silent
 * cookie-storage failures — some browsers only treat the literal
 * hostname "localhost" as a secure context for this purpose, and will
 * silently drop a Secure-flagged cookie on "http://127.0.0.1:3000" or
 * any other non-HTTPS host without any visible error.
 */
const BASE_COOKIE_OPTIONS: CookieOptions = {
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};

/**
 * Cookie options for server-set cookies (Server Components, Server
 * Actions, Route Handlers, middleware). `httpOnly: true` is correct and
 * desired here — these are the actual session cookies and must not be
 * readable from JavaScript.
 */
export const SERVER_AUTH_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
  httpOnly: true,
};

/**
 * Cookie options for the browser client (Client Components). This client
 * writes cookies via `document.cookie`, which can NEVER create an
 * HttpOnly cookie — JavaScript is structurally incapable of it. Most
 * importantly, this browser client is also the one that writes the PKCE
 * `code_verifier` cookie right before redirecting to the OAuth provider.
 * Passing `httpOnly: true` here previously caused that write to be
 * silently dropped/corrupted, which surfaced as "PKCE code verifier not
 * found in storage" once the OAuth flow redirected back to our callback.
 * Do NOT add httpOnly to this object.
 */
export const BROWSER_AUTH_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
};
