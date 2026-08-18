import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Next.js injects a small inline bootstrap script, so a static CSP cannot remove
// `unsafe-inline` without a per-request nonce. Keep every other source closed and
// allow `unsafe-eval` only for the development bundler.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://specservis.com.ua",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  ...(isProduction
    // Do not opt unrelated subdomains into HSTS from an internal dashboard.
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/cron/analytics": ["./db/analytics-v2.sql"],
    "/api/analytics-v2/refresh": ["./db/analytics-v2.sql"],
    "/api/tender-workspace": ["./db/analytics-v2.sql"],
    "/api/tender-workspace/import": ["./db/analytics-v2.sql"],
    "/api/confidential/turnover/import": ["./db/confidential-turnover.sql"],
    "/confidential": ["./db/confidential-turnover.sql"],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
        ],
      },
      {
        source: "/confidential/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
        ],
      },
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
