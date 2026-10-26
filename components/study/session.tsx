"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { isTypingTarget } from "@/lib/client/keys";
import { playCelebration, playFeedback } from "@/lib/client/sounds";
import {
  applyAnswer,
  buildQuestion,
  isCardDue,
  questionTypeForStage,
  reinsertIndex,
  selectRound,
  STAGE_NAMES,
  type Progress,
  type Question,
  type QuestionType,
  type StudyCard,
} from "@/lib/learn";
import { stopSpeaking } from "@/lib/tts";
import { useApp, useConfirm, useToast } from "../providers";
import { Confetti, ProgressBar } from "../ui";
import {
  Feedback,
  MultipleChoiceQuestion,
  NewCardQuestion,
  SpeakQuestion,
  WriteQuestion,
  type Outcome,
} from "./questions";

export type QueuePayload = {
  mode: string;
  cards: StudyCard[];
  questions: Question[];
  newAllowed: number;
  speakAvailable: boolean;
};

type Mode = "learn" | "review" | "write" | "listen" | "speak";
type LogEntry = { cardId: string; correct: boolean; before: number; after: number };

export type ReviewBody = {
  cardId: string;
  mode: string;
  questionType?: QuestionType;
  correct: boolean;
  grade?: number;
  answerGiven: string;
  responseMs: number;
  speakAvailable?: boolean;
  known?: boolean;
};

/** One API call per answer; retried once so closing the tab loses nothing already answered. */
export async function postReview(body: ReviewBody): Promise<{ progress: Progress } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await api<{ progress: Progress }>("/api/review", { body });
    } catch {
      // retry once
    }
  }
  return null;
}

export function useEscToExit(href: string, active = true) {
  const router = useRouter();
  const confirm = useConfirm();
  useEffect(() => {
    if (!active) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (isTypingTarget(e.target) && (e.target as HTMLInputElement).value) (e.target as HTMLElement).blur();
      e.preventDefault();
      if (await confirm({ title: "Exit this session?", message: "Your answers so far are saved.", confirmLabel: "Exit" })) {
        stopSpeaking();
        router.push(href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href, active, confirm, router]);
}

export function SessionHeader({ title, exitHref, children }: { title: string; exitHref: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <Link href={exitHref} className="btn-icon" aria-label="Exit session (Esc)">
        ✕
      </Link>
      <h1 className="truncate text-lg font-bold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function StudySession({
  mode,
  payload,
  title,
  exitHref,
}: {
  mode: Mode;
  payload: QueuePayload;
  title: string;
  exitHref: string;
}) {
  const { settings, speakAvailable: speakSupported } = useApp();
  const toast = useToast();
  const adaptive = mode === "learn" || mode === "review";
  const [cards, setCards] = useState<Record<string, StudyCard>>(() =>
    Object.fromEntries(payload.cards.map((c) => [c.id, c])),
  );
  const [speakOff, setSpeakOff] = useState(!speakSupported || !payload.speakAvailable);
  const speakAvailable = !speakOff;
  const [queue, setQueue] = useState<Question[]>(() =>
    payload.questions.map((q) => (q.type === "speak" && !speakSupported ? { ...q, type: "write" as const } : q)),
  );
  const [pos, setPos] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [phase, setPhase] = useState<"question" | "summary" | "done">(payload.questions.length ? "question" : "done");
  const [roundLog, setRoundLog] = useState<LogEntry[]>([]);
  const [totals, setTotals] = useState({ correct: 0, wrong: 0 });
  const [introduced, setIntroduced] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [overridable, setOverridable] = useState(false);
  const pending = useRef<{ body: ReviewBody; before: Progress; reinsertedKey?: string } | null>(null);
  const shownAt = useRef(0);

  useEscToExit(exitHref, phase !== "done");

  const current = queue[pos];
  const card = current ? cards[current.cardId] : undefined;
  const peersByDeck = useMemo(() => {
    const m = new Map<string, StudyCard[]>();
    for (const c of Object.values(cards)) m.set(c.deckId, [...(m.get(c.deckId) ?? []), c]);
    return m;
  }, [cards]);

  useEffect(() => {
    shownAt.current = performance.now();
  }, [current?.key]);

  const typeFor = useCallback(
    (c: StudyCard, p: Progress): QuestionType => {
      if (!adaptive) {
        const fixed: QuestionType = mode === "listen" ? "dictation" : mode === "speak" && speakAvailable ? "speak" : "write";
        return fixed;
      }
      return questionTypeForStage(mode === "review" ? Math.max(1, p.stage) : p.stage, p.correctStreak, {
        speakAvailable,
        deckSize: peersByDeck.get(c.deckId)?.length ?? 1,
        rand: Math.random,
      });
    },
    [adaptive, mode, speakAvailable, peersByDeck],
  );

  const commit = useCallback(
    (body: ReviewBody) => {
      void postReview(body).then((res) => {
        if (res?.progress) setCards((cs) => ({ ...cs, [body.cardId]: { ...cs[body.cardId], progress: res.progress } }));
      });
    },
    [],
  );

  function onAnswer(o: Outcome) {
    if (!current || !card || outcome) return;
    const responseMs = Math.round(performance.now() - shownAt.current);
    const before = card.progress;
    const { progress } = applyAnswer(
      before,
      { correct: o.correct, grade: o.grade, type: current.type, ladder: adaptive, responseMs },
      { advanceAfter: settings.advanceAfter, speakAvailable },
    );
    setCards((cs) => ({ ...cs, [card.id]: { ...card, progress } }));
    if (before.stage === 0 && adaptive) setIntroduced((n) => n + 1);
    const body: ReviewBody = {
      cardId: card.id,
      mode,
      questionType: current.type,
      correct: o.correct,
      grade: o.grade,
      answerGiven: o.answerGiven,
      responseMs,
      speakAvailable,
    };

    if (current.type === "flashcard") {
      commit(body);
      setRoundLog((l) => [...l, { cardId: card.id, correct: true, before: before.stage, after: progress.stage }]);
      advance();
      return;
    }

    let reinsertedKey: string | undefined;
    if (!o.correct) {
      const updated = { ...card, progress };
      const again = buildQuestion(updated, typeFor(updated, progress), peersByDeck.get(card.deckId) ?? [updated], Math.random);
      reinsertedKey = again.key;
      setQueue((qs) => {
        const copy = qs.slice();
        if (adaptive) copy.splice(reinsertIndex(pos, copy.length, Math.random), 0, again);
        else copy.push(again);
        return copy;
      });
    }
    // A typo may still be overridden ("I was right"), so its review is sent on Continue.
    if (o.verdict === "typo" && !o.correct) {
      pending.current = { body, before, reinsertedKey };
      setOverridable(true);
    } else commit(body);

    setOutcome(o);
    setTotals((t) => (o.correct ? { ...t, correct: t.correct + 1 } : { ...t, wrong: t.wrong + 1 }));
    setRoundLog((l) => [...l, { cardId: card.id, correct: o.correct, before: before.stage, after: progress.stage }]);
    setAnnounce(o.correct ? "Correct" : `Incorrect. The answer is ${card.term}`);
    if (settings.soundEffects) playFeedback(o.correct);
  }

  function override() {
    const p = pending.current;
    if (!p || !card || !outcome || !current) return;
    pending.current = null;
    setOverridable(false);
    const { progress } = applyAnswer(
      p.before,
      { correct: true, grade: 3, type: current.type, ladder: adaptive },
      { advanceAfter: settings.advanceAfter, speakAvailable },
    );
    setCards((cs) => ({ ...cs, [card.id]: { ...card, progress } }));
    if (p.reinsertedKey) setQueue((qs) => qs.filter((q) => q.key !== p.reinsertedKey));
    setOutcome({ ...outcome, correct: true, grade: 3 });
    setTotals((t) => ({ correct: t.correct + 1, wrong: Math.max(0, t.wrong - 1) }));
    setRoundLog((l) => l.map((e, i) => (i === l.length - 1 ? { ...e, correct: true, after: progress.stage } : e)));
    setAnnounce("Marked as correct");
    commit({ ...p.body, correct: true, grade: 3 });
  }

  function advance() {
    if (pending.current) {
      commit(pending.current.body);
      pending.current = null;
    }
    setOverridable(false);
    setOutcome(null);
    stopSpeaking();
    if (pos + 1 < queue.length) {
      setPos(pos + 1);
      return;
    }
    setPhase(adaptive ? "summary" : "done");
  }

  function nextRound() {
    const list = Object.values(cards);
    const now = new Date();
    let round: StudyCard[];
    if (mode === "review") {
      round = list
        .filter((c) => isCardDue(c, now))
        .sort((a, b) => new Date(a.progress.dueAt!).getTime() - new Date(b.progress.dueAt!).getTime())
        .slice(0, settings.roundSize);
    } else {
      round = selectRound(list, {
        now,
        newAllowed: Math.max(0, payload.newAllowed - introduced),
        roundSize: settings.roundSize,
      });
    }
    if (round.length === 0) {
      setPhase("done");
      return;
    }
    setQueue(
      round.map((c) =>
        buildQuestion(c, typeFor(c, c.progress), peersByDeck.get(c.deckId) ?? [c], Math.random),
      ),
    );
    setPos(0);
    setRoundLog([]);
    setPhase("question");
  }

  const disableSpeak = (reason: string) => {
    setSpeakOff(true);
    toast.show(
      reason === "not-allowed"
        ? "Microphone access was denied, so speaking questions are skipped for this session. Allow the microphone in your browser's site settings to use them."
        : "Speech recognition isn't available in this browser, so speaking questions are skipped.",
      { durationMs: 8000 },
    );
    setQueue((qs) => qs.map((q, i) => (i >= pos && q.type === "speak" ? { ...q, type: "write" } : q)));
  };

  const switchToWrite = () => setQueue((qs) => qs.map((q, i) => (i === pos ? { ...q, type: "write", key: `${q.key}w` } : q)));

  /* ------------------------------- render ------------------------------- */

  if (phase === "done") {
    return (
      <Celebration
        title={title}
        exitHref={exitHref}
        totals={totals}
        cards={Object.values(cards)}
        mode={mode}
        empty={payload.questions.length === 0}
      />
    );
  }

  if (phase === "summary") {
    const movedUp = roundLog.filter((e) => e.after > e.before);
    const mistakes = Array.from(new Set(roundLog.filter((e) => !e.correct).map((e) => e.cardId)));
    return (
      <div className="mx-auto max-w-2xl">
        <SessionHeader title={title} exitHref={exitHref} />
        <div className="panel animate-pop p-6" data-testid="round-summary">
          <h2 className="text-2xl font-extrabold">Round complete!</h2>
          <p className="mt-1 text-muted">
            {roundLog.filter((e) => e.correct).length} correct · {roundLog.filter((e) => !e.correct).length} mistakes
          </p>
          {movedUp.length > 0 && (
            <>
              <h3 className="mt-4 font-bold text-success">Moved up a stage</h3>
              <ul className="mt-1 space-y-1">
                {Array.from(new Map(movedUp.map((e) => [e.cardId, e])).values()).map((e) => (
                  <li key={e.cardId} className="flex justify-between gap-2">
                    <span className="font-semibold">{cards[e.cardId]?.term}</span>
                    <span className="text-sm text-muted">{STAGE_NAMES[cards[e.cardId]?.progress.stage ?? e.after]}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {mistakes.length > 0 && (
            <>
              <h3 className="mt-4 font-bold text-danger">Mistakes</h3>
              <ul className="mt-1 space-y-1">
                {mistakes.map((id) => (
                  <li key={id}>
                    <b>{cards[id]?.term}</b> — {cards[id]?.definition}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-6 flex gap-3">
            <Link href={exitHref} className="btn-secondary">
              Finish
            </Link>
            <button type="button" className="btn-primary flex-1" onClick={nextRound} autoFocus data-testid="next-round">
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!current || !card) return null;

  const qProps = { question: current, card, answered: outcome, onAnswer };
  return (
    <div className="mx-auto max-w-2xl">
      <SessionHeader title={title} exitHref={exitHref}>
        {adaptive && (
          <span className="chip" data-testid="stage-chip">
            {STAGE_NAMES[card.progress.stage]}
          </span>
        )}
      </SessionHeader>
      <ProgressBar value={pos + (outcome ? 1 : 0)} max={queue.length} label="Session progress" />
      <div className="sr-only" aria-live="assertive">
        {announce}
      </div>
      <div className="panel mt-4 p-4 sm:p-6" data-testid="question" data-type={current.type} data-card-id={card.id} key={current.key}>
        {current.type === "flashcard" ? (
          <NewCardQuestion {...qProps} />
        ) : current.type === "mc" || current.type === "mc_reverse" || current.type === "listen_mc" ? (
          <MultipleChoiceQuestion {...qProps} />
        ) : current.type === "speak" ? (
          <SpeakQuestion {...qProps} onSwitchToWrite={switchToWrite} onSpeechUnavailable={disableSpeak} />
        ) : (
          <WriteQuestion {...qProps} />
        )}
        {outcome && (
          <Feedback
            key={`fb-${current.key}`}
            card={card}
            outcome={outcome}
            onOverride={overridable ? override : undefined}
            onContinue={advance}
          />
        )}
      </div>
    </div>
  );
}

function Celebration({
  title,
  exitHref,
  totals,
  cards,
  mode,
  empty,
}: {
  title: string;
  exitHref: string;
  totals: { correct: number; wrong: number };
  cards: StudyCard[];
  mode: Mode;
  empty: boolean;
}) {
  const { settings } = useApp();
  useEffect(() => {
    if (!empty && settings.soundEffects) playCelebration();
  }, [empty, settings.soundEffects]);
  const mastered = cards.filter((c) => c.progress.stage >= 6).length;
  const total = totals.correct + totals.wrong;
  return (
    <div className="mx-auto max-w-xl text-center">
      {!empty && <Confetti />}
      <div className="panel animate-pop mt-6 p-8" data-testid="session-done">
        <div aria-hidden className="text-6xl">
          {empty ? "✨" : "🎉"}
        </div>
        <h1 className="mt-2 text-3xl font-black">{empty ? "Nothing to study right now" : "Session complete!"}</h1>
        <p className="mt-2 text-muted">
          {empty
            ? mode === "review"
              ? "No cards are due. Come back later!"
              : "Everything here is mastered or waiting for its next review."
            : `${totals.correct} of ${total} correct${total ? ` (${Math.round((totals.correct / total) * 100)}%)` : ""}.`}
        </p>
        {(mode === "learn" || mode === "review") && cards.length > 0 && (
          <p className="mt-1 text-muted">
            {mastered} of {cards.length} cards mastered.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={exitHref} className="btn-primary">
            Back to {title.length > 24 ? "deck" : title}
          </Link>
          <Link href="/" className="btn-secondary">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
