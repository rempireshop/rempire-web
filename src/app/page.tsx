"use client";

import { useEffect } from "react";
import Tower from "@/components/Tower";

/**
 * The root forwards to the current centre of gravity: the /demo review hub
 * (it links onward to the questionnaires and prototypes).
 */
export default function Home() {
  useEffect(() => {
    window.location.replace("/demo/");
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
