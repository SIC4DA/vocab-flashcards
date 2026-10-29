"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { playCelebration, playFeedback } from "@/lib/client/sounds";
import { langDir } from "@/lib/languages";
import { shuffle, type StudyCard } from "@/lib/learn";
import { CardImage } from "../card-image";
import { useApp } from "../providers";
import { Confetti } from "../ui";
import { SessionHeader, useEscToExit } from "./session";

type Tile = { id: string; cardId: string; kind: "term" | "definition"; card: StudyCard };
const PENALTY_MS = 1000;
const nowMs = () => performance.now();

function newGame(cards: StudyCard[]): Tile[] {
  const picked = shuffle(cards, Math.random).slice(0, 6);
  return shuffle(
    picked.flatMap((c) => [
      { id: `${c.id}-t`, cardId: c.id, kind: "term" as const, card: c },
      { id: `${c.id}-d`, cardId: c.id, kind: "definition" as const, card: c },
    ]),
    Math.random,
  );
}

export function MatchGame({
  deckId,
  cards,
  title,
  exitHref,
  initialBestMs,
}: {
  deckId: string;
  cards: StudyCard[];
  title: string;
  exitHref: string;
  initialBestMs: number | null;
}) {
  const { settings } = useApp();
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [penalty, setPenalty] = useState(0);
  const [now, setNow] = useState(0);
  const [finalMs, setFinalMs] = useState<number | null>(null);
  const [best, setBest] = useState<{ ms: number | null; isBest: boolean }>({ ms: initialBestMs, isBest: false });

  useEscToExit(exitHref, finalMs === null);

  const reset = useCallback(() => {
    setTiles(newGame(cards));
    setSelected(null);
    setMatched(new Set());
    setWrong([]);
    setPenalty(0);
    setFinalMs(null);
    const t = performance.now();
    setStartedAt(t);
    setNow(t);
  }, [cards]);

  useEffect(() => {
    // Start a game on mount (shuffling must happen on the client).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reset();
  }, [reset]);

  useEffect(() => {
    if (finalMs !== null || !startedAt) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [finalMs, startedAt]);

  const pairs = tiles.length / 2;

  function pick(tile: Tile) {
    if (finalMs !== null || matched.has(tile.cardId) || wrong.length) return;
    if (!selected) {
      setSelected(tile.id);
      return;
    }
    if (selected === tile.id) {
      setSelected(null);
      return;
    }
    const first = tiles.find((t) => t.id === selected)!;
    if (first.cardId === tile.cardId && first.kind !== tile.kind) {
      const next = new Set(matched).add(tile.cardId);
      setMatched(next);
      setSelected(null);
      if (settings.soundEffects) playFeedback(true);
      if (next.size === pairs) {
        const ms = Math.round(nowMs() - startedAt + penalty);
        setFinalMs(ms);
        if (settings.soundEffects) playCelebration();
        api<{ bestMs: number; isBest: boolean }>(`/api/decks/${deckId}/match`, { body: { timeMs: ms } })
          .then((r) => setBest({ ms: r.bestMs, isBest: r.isBest }))
          .catch(() => setBest((b) => ({ ms: b.ms === null || ms < b.ms ? ms : b.ms, isBest: b.ms === null || ms < b.ms })));
      }
    } else {
      setWrong([first.id, tile.id]);
      setPenalty((p) => p + PENALTY_MS);
      if (settings.soundEffects) playFeedback(false);
      setTimeout(() => {
        setWrong([]);
        setSelected(null);
      }, 450);
    }
  }

  const elapsed = finalMs ?? Math.max(0, now - startedAt + penalty);

  if (cards.length < 2) {
    return (
      <div className="mx-auto max-w-xl">
        <SessionHeader title={title} exitHref={exitHref} />
        <p className="panel p-6 text-center">Add at least 2 cards to play Match.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SessionHeader title={title} exitHref={exitHref}>
        <span className="chip text-base tabular-nums" aria-live="off" data-testid="match-timer">
          ⏱ {(elapsed / 1000).toFixed(1)} s
        </span>
      </SessionHeader>
      {finalMs !== null ? (
        <div className="index-card animate-pop px-8 pb-8 pt-4 text-center" data-testid="match-done">
          {best.isBest && <Confetti />}
          <h2 className="headword text-[2.6rem] tabular-nums">{(finalMs / 1000).toFixed(1)} s</h2>
          <p className="mt-2 text-muted" data-testid="match-best">
            {best.isBest ? "🏆 New best time!" : `Best: ${best.ms ? (best.ms / 1000).toFixed(1) : "–"} s`}
          </p>
          <button type="button" className="btn-primary mt-6" onClick={reset} autoFocus>
            Play again
          </button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-center text-sm text-muted">Match each term with its definition. Wrong pairs add 1 s.</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3" data-testid="match-grid">
            {tiles.map((t) => {
              const isMatched = matched.has(t.cardId);
              const isSel = selected === t.id;
              const isWrong = wrong.includes(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => pick(t)}
                    disabled={isMatched}
                    aria-pressed={isSel}
                    aria-label={isMatched ? "Matched" : t.kind === "term" ? t.card.term : t.card.definition}
                    data-testid="match-tile"
                    data-card-id={t.cardId}
                    data-kind={t.kind}
                    className={`flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center text-sm font-semibold transition-all sm:h-32 sm:text-base ${
                      isMatched
                        ? "invisible scale-90 opacity-0"
                        : isWrong
                          ? "animate-shake border-danger bg-danger-soft"
                          : isSel
                            ? "border-accent bg-accent-soft"
                            : "border-line bg-surface hover:border-accent"
                    }`}
                  >
                    {t.kind === "term" ? (
                      <span dir={langDir(t.card.termLang)} lang={t.card.termLang} className="break-words">
                        {t.card.term}
                      </span>
                    ) : t.card.imageUrl ? (
                      <>
                        <CardImage src={t.card.imageUrl} alt={t.card.definition} term={t.card.term} className="h-14 w-full sm:h-16" />
                        <span className="line-clamp-2 text-xs text-muted">{t.card.definition}</span>
                      </>
                    ) : (
                      <span dir={langDir(t.card.definitionLang)} className="break-words">
                        {t.card.definition}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
