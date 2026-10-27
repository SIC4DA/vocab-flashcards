"use client";

import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/client/keys";
import { shuffle, type StudyCard } from "@/lib/learn";
import { prefetchPronunciation, stopSpeaking } from "@/lib/tts";
import { useSpeak } from "../audio";
import { useApp } from "../providers";
import { ProgressBar } from "../ui";
import { FlipCard } from "./questions";
import { postReview, SessionHeader, useEscToExit } from "./session";

export function FlashcardsMode({ cards, title, exitHref }: { cards: StudyCard[]; title: string; exitHref: string }) {
  const { settings } = useApp();
  const speak = useSpeak();
  const [shuffled, setShuffled] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [deck, setDeck] = useState<StudyCard[]>(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stillLearning, setStillLearning] = useState<StudyCard[]>([]);
  const [known, setKnown] = useState(0);
  const [done, setDone] = useState(false);
  const [exitDir, setExitDir] = useState<"left" | "right" | null>(null);
  const shownAt = useRef(0);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEscToExit(exitHref, !done);
  const card = deck[index];
  const next = deck[index + 1];
  useEffect(() => {
    if (next) prefetchPronunciation(next.term, next.termLang);
  }, [next]);

  useEffect(() => {
    if (!card || done) return;
    shownAt.current = performance.now();
    if (!reverse && settings.autoPlayTerm) void speak(card.term, card.termLang, { auto: true });
    if (reverse && settings.autoPlayDefinition) void speak(card.definition, card.definitionLang, { auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, index, done, reverse]);

  function flip() {
    setFlipped((f) => {
      const next = !f;
      if (next && card) {
        if (!reverse && settings.autoPlayDefinition) void speak(card.definition, card.definitionLang);
        if (reverse && settings.autoPlayTerm) void speak(card.term, card.termLang);
      }
      return next;
    });
  }

  function mark(isKnown: boolean) {
    if (!card || exitDir) return;
    stopSpeaking();
    void postReview({
      cardId: card.id,
      mode: "flashcards",
      questionType: "flashcard",
      correct: isKnown,
      grade: isKnown ? 4 : undefined,
      known: isKnown,
      answerGiven: isKnown ? "know" : "still learning",
      responseMs: Math.round(performance.now() - shownAt.current),
    });
    if (isKnown) setKnown((k) => k + 1);
    else setStillLearning((s) => [...s, card]);
    setExitDir(isKnown ? "right" : "left");
    setTimeout(() => {
      setExitDir(null);
      setFlipped(false);
      if (index + 1 >= deck.length) setDone(true);
      else setIndex(index + 1);
    }, 180);
  }

  function start(list: StudyCard[], doShuffle = shuffled) {
    setDeck(doShuffle ? shuffle(list, Math.random) : list);
    setIndex(0);
    setFlipped(false);
    setStillLearning([]);
    setKnown(0);
    setDone(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || done) return;
      if (e.key === " ") {
        e.preventDefault();
        flip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        mark(true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        mark(false);
      } else if (e.key === "p" || e.key === "P") {
        if (card) void speak(flipped !== reverse ? card.definition : card.term, flipped !== reverse ? card.definitionLang : card.termLang);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <SessionHeader title={title} exitHref={exitHref} />
        <div className="panel animate-pop p-6 text-center" data-testid="flashcards-summary">
          <h2 className="text-2xl font-extrabold">Round finished</h2>
          <p className="mt-2 text-muted">
            <b className="text-success">{known}</b> known · <b className="text-warning">{stillLearning.length}</b> still learning
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {stillLearning.length > 0 && (
              <button type="button" className="btn-primary" onClick={() => start(stillLearning)} data-testid="study-still-learning">
                Study the {stillLearning.length} still-learning cards
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => start(cards)}>
              Restart
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!card) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <SessionHeader title={title} exitHref={exitHref}>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={shuffled}
            onChange={(e) => {
              setShuffled(e.target.checked);
              start(cards, e.target.checked);
            }}
          />
          Shuffle
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={reverse}
            onChange={(e) => {
              setReverse(e.target.checked);
              setFlipped(false);
            }}
          />
          Definition first
        </label>
      </SessionHeader>
      <ProgressBar value={index + 1} max={deck.length} label="Cards" />
      <div
        className={`mt-4 transition-all duration-200 ${
          exitDir === "right" ? "translate-x-16 rotate-3 opacity-0" : exitDir === "left" ? "-translate-x-16 -rotate-3 opacity-0" : ""
        }`}
        onPointerDown={(e) => {
          touch.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.clientX - t.x;
          if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(e.clientY - t.y)) mark(dx > 0);
        }}
        style={{ touchAction: "pan-y" }}
      >
        <FlipCard key={card.id + index} card={card} flipped={flipped} onFlip={flip} reverse={reverse} />
      </div>
      <p className="mt-2 text-center text-xs text-muted">Tap to flip · swipe or use ← / → to sort</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" className="btn-secondary border-warning text-warning" onClick={() => mark(false)} data-testid="still-learning">
          ← Still learning
        </button>
        <button type="button" className="btn-secondary border-success text-success" onClick={() => mark(true)} data-testid="know-it">
          Know it →
        </button>
      </div>
    </div>
  );
}
