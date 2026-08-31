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
  /**
   * The shop is one static page that now names its screen in the URL, so the
   * back button works and a category can be linked to. Those paths have no
   * files behind them — every one of them serves the same shell, which reads
   * the path back into its state on boot. Products are the exception: they
   * are written out per product for their link previews, so /shop/p/... is
   * already real and must not be swallowed here.
   */
  async rewrites() {
    return [
      { source: "/shop/c/:cat", destination: "/shop/index.html" },
      { source: "/shop/b/:brand", destination: "/shop/index.html" },
      { source: "/shop/:screen(search|brands|account|checkout|done|admin)", destination: "/shop/index.html" },
      /* /shop2/ is the second-round-feedback variant living beside the
         original for comparison. One shell serves every path under it —
         including /shop2/p/..., which has no per-product files of its own. */
      { source: "/shop2/:path+", destination: "/shop2/index.html" },
    ];
  },
};

export default nextConfig;
