import type { NextConfig } from "next";

/**
 * Serverful Next.js on Vercel: /api/submit persists questionnaire answers
 * (Vercel Blob) and forwards them to Telegram/email when tokens are set.
 * Static export was dropped for exactly this reason on 2026-08-21.
 */
const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
