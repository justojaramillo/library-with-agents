import type { NextConfig } from "next";

/**
 * Content-Security-Policy solo en producción (el modo desarrollo de Next necesita `eval`). ADR-0008.
 * Si el ingreso falla en producción, revisa primero `connect-src`: el cliente de Firebase Authentication
 * habla con estos dominios y uno que falte rompe el login.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const BASE_SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

function securityHeaders(): { key: string; value: string }[] {
  if (process.env.NODE_ENV === "production") {
    return [...BASE_SECURITY_HEADERS, { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY }];
  }
  return BASE_SECURITY_HEADERS;
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
