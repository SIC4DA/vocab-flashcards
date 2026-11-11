"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, tzOffset } from "@/lib/client/api";
import { isTypingTarget } from "@/lib/client/keys";
import { playCelebration, playFeedback } from "@/lib/client/sounds";
import {
  applyAnswer,
  buildQuestion,
  deckTopics,
  doneToday,
  MAX_STAGE,
  nextRoundIds,
  questionTypeForStage,
  reinsertIndex,
  STAGE_NAMES,
  topicSummary,
  type SessionKind,
  type Progress,
  type Question,
  type QuestionType,
  type StudyCard,
} from "@/lib/learn";
import { prefetchPronunciation, stopSpeaking } from "@/lib/tts";
import { useApp, useConfirm } from "../providers";
import { CloseIcon } from "../icons";
import { WeekStrip, type Week } from "../streak";
import { Confetti, ProgressBar } from "../ui";
import {
  Feedback,
  MultipleChoiceQuestion,
  NewCardQuestion,
  WriteQuestion,
  type Outcome,
} from "./questions";

export type LearnSession = {
  items: { id: string; kind: SessionKind }[];
  today: string;
  stepsPerDay: number;
  topic: string | null;
  topics: ReturnType<typeof topicSummary> | null;
  bonus: number;
};

export type QueuePayload = {
  mode: string;
  cards: StudyCard[];
  questions: Question[];
  newAllowed: number;
  session?: LearnSession | null;
  /** Daily review only: today's status. */
  daily?: DailyInfo;
};

export type DailyInfo = { day: string; total: number; answered: number; completed: boolean; known: number; bonus: number };

type Mode = "learn" | "daily" | "write" | "listen";
type LogEntry = { cardId: string; correct: boolean; before: number; after: number };

export type ReviewBody = {
  cardId: string;
  mode: string;
  questionType?: QuestionType | "article" | "plural";
  correct: boolean;
  grade?: number;
  answerGiven: string;
  responseMs: number;
  known?: boolean;
  tz?: number;
};

/** One API call per answer; retried once so closing the tab loses nothing already answered. */
export async function postReview(body: ReviewBody): Promise<{ progress: Progress } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await api<{ progress: Progress }>("/api/review", { body: { tz: tzOffset(), ...body } });
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
        <CloseIcon size={20} />
      </Link>
      <h1 className="truncate text-xl font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function StudySession({
  mode,
  payload,
  title,
  exitHref,
  onKeepGoing,
}: {
  mode: Mode;
  payload: QueuePayload;
  title: string;
  exitHref: string;
  /** Start another (bonus) session after today's is done. */
  onKeepGoing?: () => void;
}) {
  const { settings } = useApp();
  const adaptive = mode === "learn";
  const session = payload.session ?? null;
  const kindOf = useMemo(() => new Map((session?.items ?? []).map((it) => [it.id, it.kind])), [session]);
  const [startStages] = useState(() => new Map(payload.cards.map((c) => [c.id, c.progress.stage])));
  const isDone = useCallback(
    (c: { id: string; progress: Progress }) =>
      session ? doneToday(c.progress, kindOf.get(c.id) ?? "learning", session.today, session.stepsPerDay) : false,
    [session, kindOf],
  );
  const [cards, setCards] = useState<Record<string, StudyCard>>(() =>
    Object.fromEntries(payload.cards.map((c) => [c.id, c])),
  );
  const [queue, setQueue] = useState<Question[]>(payload.questions);
  const [pos, setPos] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [phase, setPhase] = useState<"question" | "summary" | "done">(payload.questions.length ? "question" : "done");
  const [roundLog, setRoundLog] = useState<LogEntry[]>([]);
  const [totals, setTotals] = useState({ correct: 0, wrong: 0 });
  const [announce, setAnnounce] = useState("");
  const [overridable, setOverridable] = useState(false);
  const inFlight = useRef<Promise<unknown>[]>([]);
  const reasked = useRef(new Set<string>());
  const pending = useRef<{ body: ReviewBody; before: Progress; reinsertedKey?: string } | null>(null);
  const shownAt = useRef(0);

  useEscToExit(exitHref, phase !== "done");

  const current = queue[pos];
  const wordQ = current;
  const card = wordQ ? cards[wordQ.cardId] : undefined;
  const peersByDeck = useMemo(() => {
    const m = new Map<string, StudyCard[]>();
    for (const c of Object.values(cards)) m.set(c.deckId, [...(m.get(c.deckId) ?? []), c]);
    return m;
  }, [cards]);

  useEffect(() => {
    shownAt.current = performance.now();
  }, [current?.key]);

  // Look up the next word's recording in advance so it plays instantly.
  const nextQ = queue[pos + 1];
  const nextCard = nextQ ? cards[nextQ.cardId] : undefined;
  useEffect(() => {
    if (card) prefetchPronunciation(card.term, card.termLang);
    if (nextCard) prefetchPronunciation(nextCard.term, nextCard.termLang);
  }, [card, nextCard]);

  const typeFor = useCallback(
    (c: StudyCard, p: Progress): QuestionType => {
      if (!adaptive) {
        return mode === "listen" ? "dictation" : "write";
      }
      return questionTypeForStage(p.stage, p.correctStreak, {
        deckSize: peersByDeck.get(c.deckId)?.length ?? 1,
        rand: Math.random,
      });
    },
    [adaptive, mode, peersByDeck],
  );

  const commit = useCallback(
    (body: ReviewBody) => {
      const p = postReview(body).then((res) => {
        if (res?.progress) setCards((cs) => ({ ...cs, [body.cardId]: { ...cs[body.cardId], progress: res.progress } }));
      });
      inFlight.current.push(p);
    },
    [],
  );

  function onAnswer(o: Outcome) {
    if (!current || !card || !wordQ || outcome) return;
    const responseMs = Math.round(performance.now() - shownAt.current);
    const before = card.progress;
    const { progress } = applyAnswer(
      before,
      { correct: o.correct, grade: o.grade, type: wordQ.type, ladder: adaptive, responseMs },
      { advanceAfter: settings.advanceAfter, today: session?.today },
    );
    setCards((cs) => ({ ...cs, [card.id]: { ...card, progress } }));
    const body: ReviewBody = {
      cardId: card.id,
      mode,
      questionType: wordQ.type,
      correct: o.correct,
      grade: o.grade,
      answerGiven: o.answerGiven,
      responseMs,
    };

    if (wordQ.type === "flashcard") {
      commit(body);
      setRoundLog((l) => [...l, { cardId: card.id, correct: true, before: before.stage, after: progress.stage }]);
      advance();
      return;
    }

    let reinsertedKey: string | undefined;
    // A missed word comes back later in the round — unless it has had enough for today
    // (in the daily review: once, at the end).
    const again = mode === "daily" ? !reasked.current.has(card.id) : !isDone({ ...card, progress });
    if (!o.correct && again) {
      reasked.current.add(card.id);
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
    if (!p || !card || !outcome || !wordQ) return;
    pending.current = null;
    setOverridable(false);
    const { progress } = applyAnswer(
      p.before,
      { correct: true, grade: 3, type: wordQ.type, ladder: adaptive },
      { advanceAfter: settings.advanceAfter, today: session?.today },
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
    if (!session) {
      setPhase("done");
      return;
    }
    const ids = nextRoundIds(session.items, (id) => cards[id].progress, {
      today: session.today,
      stepsPerDay: session.stepsPerDay,
      roundSize: settings.roundSize,
    });
    if (ids.length === 0) {
      setPhase("done");
      return;
    }
    setQueue(
      ids.map((id) =>
        buildQuestion(cards[id], typeFor(cards[id], cards[id].progress), peersByDeck.get(cards[id].deckId) ?? [cards[id]], Math.random),
      ),
    );
    setPos(0);
    setRoundLog([]);
    setPhase("question");
  }

  const sessionTotal = session?.items.length ?? 0;
  const sessionDone = session
    ? session.items.filter((it) => {
        const x = cards[it.id];
        return x && isDone(x);
      }).length
    : 0;

  /* ------------------------------- render ------------------------------- */

  if (phase === "done" && mode === "daily") {
    return (
      <DailyDone
        info={payload.daily}
        totals={totals}
        empty={payload.questions.length === 0}
        pending={inFlight.current}
        onKeepGoing={onKeepGoing}
      />
    );
  }

  if (phase === "done") {
    return (
      <Celebration
        title={title}
        exitHref={exitHref}
        totals={totals}
        cards={Object.values(cards)}
        startStages={startStages}
        session={session}
        mode={mode}
        empty={payload.questions.length === 0}
        onKeepGoing={onKeepGoing}
      />
    );
  }

  if (phase === "summary") {
    const movedUp = roundLog.filter((e) => e.after > e.before);
    const mistakes = Array.from(new Set(roundLog.filter((e) => !e.correct).map((e) => e.cardId)));
    return (
      <div className="mx-auto max-w-2xl">
        <SessionHeader title={title} exitHref={exitHref} />
        <div className="index-card animate-pop px-6 pb-6 pt-3 sm:px-8" data-testid="round-summary">
          <h2 className="text-[1.6rem] font-semibold leading-[44px]">Round complete!</h2>
          {session && (
            <div className="mt-3">
              <ProgressBar value={sessionDone} max={sessionTotal} label="Words done for today" />
              <p className="mt-1 text-sm text-muted">Words done for today</p>
            </div>
          )}
          <p className="mt-1 text-muted">
            {roundLog.filter((e) => e.correct).length} correct · {roundLog.filter((e) => !e.correct).length} mistakes
          </p>
          {movedUp.length > 0 && (
            <>
              <h3 className="mt-4 font-semibold text-success">Moved up a stage</h3>
              <ul className="mt-1 space-y-1">
                {Array.from(new Map(movedUp.map((e) => [e.cardId, e])).values()).map((e) => (
                  <li key={e.cardId} className="flex justify-between gap-2">
                    <span className="font-semibold">{cards[e.cardId]?.term}</span>
                    <span className="text-sm text-muted">
                      {STAGE_NAMES[cards[e.cardId]?.progress.stage ?? e.after]}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {mistakes.length > 0 && (
            <>
              <h3 className="mt-4 font-semibold text-danger">Mistakes</h3>
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
              Stop for now
            </Link>
            <button type="button" className="btn-primary flex-1" onClick={nextRound} autoFocus data-testid="next-round">
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!wordQ || !card) return null;

  const qProps = { question: wordQ, card, answered: outcome, onAnswer };
  return (
    <div className="mx-auto max-w-2xl">
      <SessionHeader title={title} exitHref={exitHref}>
        {session?.topic && mode === "learn" && (
          <span className="chip hidden sm:inline-flex" data-testid="topic-chip" title="Topic new words come from">
            {session.topic}
          </span>
        )}
        {mode === "daily" && (
          <span className="chip" data-testid="daily-chip">
            {payload.daily?.bonus ? "Extra review" : "Daily review"}
          </span>
        )}
        {adaptive && (
          <span className="chip" data-testid="stage-chip">
            {STAGE_NAMES[card.progress.stage]}
          </span>
        )}
      </SessionHeader>
      {session ? (
        <>
          <ProgressBar value={sessionDone} max={sessionTotal} label="Words done for today" />
          <p className="mt-1 text-xs text-muted" data-testid="round-position">
            Today&apos;s progress · question {pos + 1} of {queue.length} in this round
          </p>
        </>
      ) : (
        <ProgressBar value={pos + (outcome ? 1 : 0)} max={queue.length} label="Session progress" />
      )}
      <div className="sr-only" aria-live="assertive">
        {announce}
      </div>
      <div
        className={wordQ.type === "flashcard" ? "mt-5" : "index-card mt-5 px-4 pb-6 pt-4 sm:px-8"}
        data-testid="question"
        data-type={wordQ.type}
        data-card-id={card.id}
        key={wordQ.key}
      >
        {wordQ.type === "flashcard" ? (
          <NewCardQuestion {...qProps} />
        ) : wordQ.type === "mc" || wordQ.type === "mc_reverse" || wordQ.type === "listen_mc" ? (
          <MultipleChoiceQuestion {...qProps} />
        ) : (
          <WriteQuestion {...qProps} />
        )}
        {outcome && (
          <Feedback
            key={`fb-${wordQ.key}`}
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
  startStages,
  session,
  mode,
  empty,
  onKeepGoing,
}: {
  title: string;
  exitHref: string;
  totals: { correct: number; wrong: number };
  cards: StudyCard[];
  startStages: Map<string, number>;
  session: LearnSession | null;
  mode: Mode;
  empty: boolean;
  onKeepGoing?: () => void;
}) {
  const { settings } = useApp();
  useEffect(() => {
    if (!empty && settings.soundEffects) playCelebration();
  }, [empty, settings.soundEffects]);
  const total = totals.correct + totals.wrong;
  const sessionIds = new Set(session?.items.map((it) => it.id));
  const daily = mode === "learn";
  const practised = cards.filter((c) => sessionIds.has(c.id) && c.progress.dayKey === session?.today).length;
  const steppedUp = cards.filter((c) => c.progress.stage > (startStages.get(c.id) ?? c.progress.stage)).length;
  const masteredToday = cards.filter((c) => c.progress.stage >= MAX_STAGE && (startStages.get(c.id) ?? 0) < MAX_STAGE).length;
  const topics = mode === "learn" ? topicSummary(deckTopics(cards)) : [];
  const topicBefore = session?.topic ?? null;
  const topicNow = topics.find((t) => t.current)?.label ?? null;
  const finishedTopic = topicBefore && topicBefore !== topicNow ? topicBefore : null;

  return (
    <div className="mx-auto max-w-xl text-center">
      {!empty && <Confetti />}
      <div className="index-card animate-pop mt-6 px-6 pb-8 pt-3 sm:px-10" data-testid="session-done">
        {!empty && (
          <div
            aria-hidden
            className="mx-auto mt-5 grid h-20 w-20 -rotate-6 place-items-center rounded-full border-[3px] border-margin font-display text-sm font-bold leading-tight text-margin opacity-90"
          >
            <span>
              Well
              <br />
              done
            </span>
          </div>
        )}
        <h1 className="mt-4 text-[2rem] font-semibold" data-testid="session-title">
          {!daily
            ? "Session complete!"
            : finishedTopic
              ? `${finishedTopic} complete!`
              : empty
                ? "Nothing waiting right now"
                : "Nice work!"}
        </h1>
        <p className="mt-2 text-muted">
          {empty
            ? "Every word you’re learning has had its practice for now. Keep going to practise more and meet new words."
            : `${totals.correct} of ${total} answers correct${total ? ` (${Math.round((totals.correct / total) * 100)}%)` : ""}.`}
        </p>
        {daily && !empty && (
          <ul className="mx-auto mt-4 max-w-xs text-left text-[0.95rem] leading-8" data-testid="day-stats">
            <li>{practised} words practised</li>
            <li>{steppedUp} words moved up</li>
            <li>{masteredToday} words mastered today</li>
          </ul>
        )}
        {finishedTopic && (
          <p className="mt-4 border-l-4 border-success bg-success-soft px-4 py-2 text-left font-semibold text-success" data-testid="topic-finished">
            {topicNow
              ? `You finished ${finishedTopic}. ${topicNow} is next.`
              : `You finished ${finishedTopic}, the last set. Every word in this deck is under way.`}
          </p>
        )}
        <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          {daily && onKeepGoing && finishedTopic && topicNow ? (
            <button type="button" className="btn-primary px-8 text-lg" onClick={onKeepGoing} autoFocus data-testid="start-next-set">
              Start {topicNow}
            </button>
          ) : daily && onKeepGoing ? (
            <button type="button" className="btn-primary px-8 text-lg" onClick={onKeepGoing} autoFocus data-testid="keep-going">
              Keep going
            </button>
          ) : null}
          <Link href={exitHref} className={daily && onKeepGoing ? "btn-secondary" : "btn-primary"}>
            Back to {title.length > 24 ? "deck" : title}
          </Link>
        </div>
      </div>
    </div>
  );
}

type DueInfo = { streak: number; week: Week; daily: { completed: boolean } };

/** End of a daily review (or an extra batch): the streak, this week, and an offer to keep going. */
function DailyDone({
  info,
  totals,
  empty,
  pending,
  onKeepGoing,
}: {
  info?: DailyInfo;
  totals: { correct: number; wrong: number };
  empty: boolean;
  pending: Promise<unknown>[];
  onKeepGoing?: () => void;
}) {
  const { settings } = useApp();
  const [due, setDue] = useState<DueInfo | null>(null);
  useEffect(() => {
    // Wait for the last answers to be saved, so the streak includes today.
    void Promise.allSettled(pending)
      .then(() => api<DueInfo>(`/api/study/due?tz=${tzOffset()}`))
      .then(setDue)
      .catch(() => setDue(null));
  }, [pending]);
  useEffect(() => {
    if (!empty && settings.soundEffects) playCelebration();
  }, [empty, settings.soundEffects]);

  const bonus = info?.bonus ?? 0;
  const nothingKnown = empty && (info?.known ?? 0) === 0;
  const total = totals.correct + totals.wrong;
  const title = nothingKnown
    ? "Nothing to review yet"
    : empty
      ? bonus
        ? "You’ve reviewed everything for today"
        : "Today’s review is done"
      : bonus
        ? "Extra review done"
        : "Daily review done!";

  return (
    <div className="mx-auto max-w-xl text-center">
      {!empty && !bonus && <Confetti />}
      <div className="index-card animate-pop mt-6 px-6 pb-8 pt-3 sm:px-10" data-testid="daily-done">
        <h1 className="mt-4 text-[2rem] font-semibold">{title}</h1>
        <p className="mt-2 text-muted">
          {nothingKnown
            ? "The daily review brings back words you already know — ones you’ve written from memory in Learn. Learn a few words first; they’ll show up here."
            : empty
              ? bonus
                ? "Every word you know has had a look today. Come back tomorrow."
                : "You’ve already finished today’s review."
              : `${totals.correct} of ${total} answers correct${total ? ` (${Math.round((totals.correct / total) * 100)}%)` : ""}.`}
        </p>
        {!nothingKnown && (
          <div className="mt-5 flex flex-col items-center gap-3">
            <p className="text-lg" data-testid="daily-streak">
              <span className="font-display text-3xl font-semibold tabular-nums">{due ? due.streak : "–"}</span>{" "}
              <span className="text-muted">day streak</span>
            </p>
            {due && <WeekStrip week={due.week} />}
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn-primary">
            Dashboard
          </Link>
          {!nothingKnown && onKeepGoing && !(empty && bonus) && (
            <button type="button" className="btn-secondary" onClick={onKeepGoing} data-testid="keep-reviewing">
              Keep reviewing
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
