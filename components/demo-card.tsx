"use client";

import { useState } from "react";

/** A sample index card on the landing page: tap to turn it over. */
export function DemoCard() {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="flip-scene w-full max-w-md justify-self-center lg:justify-self-end">
      <div
        role="button"
        tabIndex={0}
        aria-label={flipped ? "Sample card, back: dog. Activate to turn over" : "Sample card, front: der Hund. Activate to turn over"}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFlipped((f) => !f);
          }
        }}
        className={`flip-card h-72 w-full cursor-pointer select-none rotate-[-1.5deg] ${flipped ? "is-flipped" : ""}`}
      >
        <div className="flip-face index-card ruled flex flex-col px-8 pt-3" inert={flipped}>
          <span className="flex h-8 items-center justify-between text-sm text-muted">
            <span>German</span>
            <span>new word</span>
          </span>
          <span className="headword mt-10 text-center text-[3.4rem] leading-none">der Hund</span>
          <span className="mt-auto pb-5 text-center text-sm text-muted">Tap to turn over</span>
        </div>
        <div className="flip-face flip-back index-card ruled flex flex-col px-8 pt-3" inert={!flipped}>
          <span className="flex h-8 items-center text-sm text-muted">English</span>
          <span className="headword mt-6 text-center text-[2.6rem] leading-none">dog</span>
          <span className="mt-6 text-center font-display italic leading-8">“Der Hund schläft im Garten.”</span>
          <span className="text-center text-sm leading-8 text-muted">The dog is sleeping in the garden.</span>
        </div>
      </div>
    </div>
  );
}
