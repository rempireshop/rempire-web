"use client";

import { useEffect } from "react";
import Tower from "@/components/Tower";

/**
 * The root has nothing to show during the questionnaire phase — it forwards
 * to /qa. Client-side because static export cannot emit server redirects.
 */
export default function Home() {
  useEffect(() => {
    window.location.replace("/qa/");
  }, []);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6">
      <Tower className="h-24 w-auto" />
      <a
        href="/qa/"
        className="font-display text-2xl uppercase tracking-[0.25em] underline-offset-8 hover:underline"
      >
        Rempire
      </a>
    </main>
  );
}
