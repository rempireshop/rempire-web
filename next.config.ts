import type { NextConfig } from "next";

/**
 * Static export for the questionnaire phase.
 *
 * Nothing on the site needs a server yet — /qa is a client-side form that
 * keeps its state in localStorage. Exporting to plain HTML keeps the Vercel
 * deploy trivial and the site portable. When the real storefront lands and
 * needs RSC/ISR, delete `output: "export"` and this note.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
