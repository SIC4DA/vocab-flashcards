"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError, tzOffset } from "@/lib/client/api";
import { FlashcardsMode } from "./flashcards-mode";
import { GrammarGame } from "./grammar-game";
import { MatchGame } from "./match-game";
import { StudySession, type QueuePayload } from "./session";
import { TestRunner } from "./test-runner";

export type StudyMode = "learn" | "flashcards" | "write" | "listen" | "match" | "test" | "daily" | "grammar";

function SessionSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-4" aria-busy="true" aria-label="Loading session">
      <div className="skeleton h-8 w-1/2" />
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-80 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <div className="skeleton h-12" />
        <div className="skeleton h-12" />
      </div>
    </div>
  );
}

export function StudyLoader({
  mode,
  deckId,
  title,
  cardCount,
  matchBestMs,
}: {
  mode: StudyMode;
  deckId?: string;
  title: string;
  cardCount: number;
  matchBestMs?: number | null;
}) {
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [bonus, setBonus] = useState(0);
  const [error, setError] = useState("");
  const exitHref = deckId ? `/decks/${deckId}` : "/";

  useEffect(() => {
    if (mode === "test") return;
    const params = new URLSearchParams({ mode, tz: String(tzOffset()), bonus: String(bonus) });
    if (deckId) params.set("deckId", deckId);
    api<QueuePayload>(`/api/study/queue?${params}`)
      .then(setPayload)
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load this session"));
  }, [mode, deckId, bonus]);

  if (mode === "test" && deckId) return <TestRunner deckId={deckId} cardCount={cardCount} title={title} exitHref={exitHref} />;
  if (error) {
    return (
      <div className="panel mx-auto max-w-xl p-6 text-center" role="alert">
        <p className="font-semibold text-danger">{error}</p>
        <Link href={exitHref} className="btn-secondary mt-4">
          Back
        </Link>
      </div>
    );
  }
  if (!payload) return <SessionSkeleton />;

  switch (mode) {
    case "flashcards":
      return <FlashcardsMode cards={payload.cards} title={title} exitHref={exitHref} />;
    case "grammar":
      return <GrammarGame deckId={deckId!} cards={payload.cards} title={title} exitHref={exitHref} />;
    case "match":
      return (
        <MatchGame deckId={deckId!} cards={payload.cards} title={title} exitHref={exitHref} initialBestMs={matchBestMs ?? null} />
      );
    default:
      return (
        <StudySession
          key={`${bonus}`}
          mode={mode as "learn"}
          payload={payload}
          title={title}
          exitHref={exitHref}
          onKeepGoing={
            (mode === "learn" && bonus < 3) || mode === "daily"
              ? () => {
                  setPayload(null);
                  setBonus((b) => b + 1);
                }
              : undefined
          }
        />
      );
  }
}
