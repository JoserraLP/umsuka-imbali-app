import type { NextConfig } from "next";

/**
 * Origin of the Supabase project (trailing slash trimmed). Used to build the
 * runtime-cache urlPatterns; degraded to a never-matching host when the
 * variable is not present at build time so nothing is accidentally cached.
 */
const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://supabase.local")
  .trim()
  .replace(/\/+$/, "");

/** Escape a string for safe inclusion inside a RegExp source. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Supabase API pattern matching only the given path prefix. */
const supabasePattern = (pathname: string) =>
  new RegExp(`^${escapeRegExp(SUPABASE_ORIGIN)}/${pathname}`);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  // Custom offline fallback for navigations that fail while offline. Never
  // hijack auth/API/admin traffic or plain static assets.
  navigateFallback: "/offline",
  navigateFallbackDenylist: [
    /^\/auth\//,
    /^\/api\//,
    /^\/admin/,
    /\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|json|css|js|woff2?)$/i,
  ],
  // The offline page is part of the app shell, so it must be precached.
  additionalManifestEntries: [{ url: "/offline", revision: "umsuka-offline-v1" }],
  runtimeCaching: [
    {
      // Supabase PostgREST: prefer the network for fresh data, fall back to
      // a short-lived cache (15 min, 60 entries) while offline.
      urlPattern: supabasePattern("rest/v1/"),
      handler: "NetworkFirst",
      method: "GET",
      options: {
        cacheName: "umsuka-api-v1",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 60, maxAgeSeconds: 900 },
        cacheableResponse: { statuses: [0, 200] },
        plugins: [
          {
            // Identity-scoped cache key: derive the workbox cache key from
            // the Authorization token (hashed, never stored raw) so cached
            // API responses of one user can never leak to another user on a
            // shared device (PII like phone/email in profiles endpoints).
            //
            // IMPORTANT: workbox-build serializes this plugin literally into
            // the generated public/sw.js, so the hash must stay self-contained
            // inside the function body (no external references).
            cacheKeyWillBeUsed: async ({ request }: { request: Request }) => {
              const auth = request.headers.get("Authorization") ?? "anon";
              // FNV-1a 32-bit — short stable hash, no dependencies.
              let hash = 0x811c9dc5;
              for (let i = 0; i < auth.length; i++) {
                hash ^= auth.charCodeAt(i);
                hash = Math.imul(hash, 0x01000193);
              }
              return `${request.url}::${(hash >>> 0).toString(36)}`;
            },
          },
        ],
      },
    },
    {
      // Supabase Auth: NEVER cache tokens, cookies or OAuth traffic.
      urlPattern: supabasePattern("auth/v1/"),
      handler: "NetworkOnly",
      method: "GET",
    },
    {
      // Compiled app assets. Precached chunks are served from the precache;
      // this catches new/post-deploy chunks with a long-lived stale cache.
      urlPattern: /\/_next\/static\/.+$/i,
      handler: "StaleWhileRevalidate",
      method: "GET",
      options: {
        cacheName: "umsuka-static-v1",
        expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      // Static images/manifest from /public: safe to cache-first for 30 days.
      urlPattern: /(?:\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif)$|\/manifest\.json$)/i,
      handler: "CacheFirst",
      method: "GET",
      options: {
        cacheName: "umsuka-images-v1",
        expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      // The offline page itself: network-first while online so the latest
      // copy is kept, and available instantly once the SW caches it.
      urlPattern: /^\/offline(?:[/?#]|$)/,
      handler: "NetworkFirst",
      method: "GET",
      options: {
        cacheName: "umsuka-offline-v1",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 5, maxAgeSeconds: 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],
});

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com https://images.unsplash.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-src 'self' https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withPWA(nextConfig);
