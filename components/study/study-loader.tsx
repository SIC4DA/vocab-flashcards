"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError, tzOffset } from "@/lib/client/api";
import { useApp } from "../providers";
import { FlashcardsMode } from "./flashcards-mode";
import { MatchGame } from "./match-game";
import { StudySession, type QueuePayload } from "./session";
import { TestRunner } from "./test-runner";

export type StudyMode = "learn" | "flashcards" | "write" | "listen" | "speak" | "match" | "test" | "review";

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
  const { speakAvailable, speechSupported } = useApp();
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [error, setError] = useState("");
  const exitHref = deckId ? `/decks/${deckId}` : "/";
  const ready = speechSupported !== null; // wait for client-side feature detection

  useEffect(() => {
    if (!ready || mode === "test") return;
    if (mode === "speak" && !speakAvailable) return;
    const params = new URLSearchParams({ mode, speak: speakAvailable ? "1" : "0", tz: String(tzOffset()) });
    if (deckId) params.set("deckId", deckId);
    api<QueuePayload>(`/api/study/queue?${params}`)
      .then(setPayload)
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Couldn't load this session"));
  }, [ready, mode, deckId, speakAvailable]);

  if (mode === "speak" && ready && !speakAvailable) {
    return (
      <div className="panel mx-auto max-w-xl p-6 text-center">
        <h1 className="text-2xl font-bold">Speaking isn&apos;t available</h1>
        <p className="mt-2 text-muted">
          {speechSupported === false
            ? "This browser doesn't support speech recognition (Firefox doesn't). Try Chrome, Edge or Safari."
            : "Speaking questions are turned off in Settings."}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/decks/${deckId}/study/write`} className="btn-primary">
            Practise writing instead
          </Link>
          <Link href={exitHref} className="btn-secondary">
            Back
          </Link>
        </div>
      </div>
    );
  }

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
    case "match":
      return (
        <MatchGame deckId={deckId!} cards={payload.cards} title={title} exitHref={exitHref} initialBestMs={matchBestMs ?? null} />
      );
    default:
      return <StudySession mode={mode as "learn"} payload={payload} title={title} exitHref={exitHref} />;
  }
}
