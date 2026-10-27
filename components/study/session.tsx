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
import { Confetti, ProgressBar } from "../ui";
import {
  Feedback,
  MultipleChoiceQuestion,
  NewCardQuestion,
  WriteQuestion,
  type Outcome,
} from "./questions";
import {
  FillBlankQuestion,
  QaMatchQuestion,
  SentenceFeedback,
  SentenceReadQuestion,
  WordOrderQuestion,
  type SentenceOutcome,
} from "./sentence-questions";
import {
  applySentenceAnswer,
  buildSentenceQuestion,
  SENTENCE_MASTERED,
  SENTENCE_STAGE_NAMES,
  sentenceTypeForStage,
  type SentenceQuestion,
  type StudySentence,
} from "@/lib/sentences";

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
  questions: (Question | SentenceQuestion)[];
  newAllowed: number;
  session?: LearnSession | null;
  sentences?: StudySentence[];
};

const isSentenceQ = (q: Question | SentenceQuestion | undefined): q is SentenceQuestion => Boolean(q && "sentenceId" in q);

type Mode = "learn" | "review" | "write" | "listen" | "sentences";
type LogEntry = { cardId: string; correct: boolean; before: number; after: number };

export type ReviewBody = {
  cardId: string;
  mode: string;
  questionType?: QuestionType;
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
  const adaptive = mode === "learn" || mode === "review" || mode === "sentences";
  const session = payload.session ?? null;
  const kindOf = useMemo(() => new Map((session?.items ?? []).map((it) => [it.id, it.kind])), [session]);
  const [startStages] = useState(() => new Map(payload.cards.map((c) => [c.id, c.progress.stage])));
  const isDone = useCallback(
    (c: { id: string; progress: Progress }) =>
      session ? doneToday(c.progress, kindOf.get(c.id) ?? "learning", session.today, session.stepsPerDay) : false,
    [session, kindOf],
  );
  const [sentences, setSentences] = useState<Record<string, StudySentence>>(() =>
    Object.fromEntries((payload.sentences ?? []).map((x) => [x.id, x])),
  );
  const [startSentenceStages] = useState(() => new Map((payload.sentences ?? []).map((x) => [x.id, x.progress.stage])));
  const [sentenceOutcome, setSentenceOutcome] = useState<SentenceOutcome | null>(null);
  const [cards, setCards] = useState<Record<string, StudyCard>>(() =>
    Object.fromEntries(payload.cards.map((c) => [c.id, c])),
  );
  const [queue, setQueue] = useState<(Question | SentenceQuestion)[]>(payload.questions);
  const [pos, setPos] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [phase, setPhase] = useState<"question" | "summary" | "done">(payload.questions.length ? "question" : "done");
  const [roundLog, setRoundLog] = useState<LogEntry[]>([]);
  const [totals, setTotals] = useState({ correct: 0, wrong: 0 });
  const [announce, setAnnounce] = useState("");
  const [overridable, setOverridable] = useState(false);
  const pending = useRef<{ body: ReviewBody; before: Progress; reinsertedKey?: string } | null>(null);
  const shownAt = useRef(0);

  useEscToExit(exitHref, phase !== "done");

  const current = queue[pos];
  const sentenceQ = isSentenceQ(current) ? current : undefined;
  const wordQ = current && !isSentenceQ(current) ? current : undefined;
  const card = wordQ ? cards[wordQ.cardId] : undefined;
  const sentence = sentenceQ ? sentences[sentenceQ.sentenceId] : undefined;
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
  const nextCard = nextQ && !isSentenceQ(nextQ) ? cards[nextQ.cardId] : undefined;
  useEffect(() => {
    if (card) prefetchPronunciation(card.term, card.termLang);
    if (nextCard) prefetchPronunciation(nextCard.term, nextCard.termLang);
  }, [card, nextCard]);

  const typeFor = useCallback(
    (c: StudyCard, p: Progress): QuestionType => {
      if (!adaptive) {
        return mode === "listen" ? "dictation" : "write";
      }
      return questionTypeForStage(mode === "review" ? Math.max(1, p.stage) : p.stage, p.correctStreak, {
        deckSize: peersByDeck.get(c.deckId)?.length ?? 1,
        rand: Math.random,
      });
    },
    [adaptive, mode, peersByDeck],
  );

  const commit = useCallback(
    (body: ReviewBody) => {
      void postReview(body).then((res) => {
        if (res?.progress) setCards((cs) => ({ ...cs, [body.cardId]: { ...cs[body.cardId], progress: res.progress } }));
      });
    },
    [],
  );

  const sentenceQuestionFor = (st: StudySentence) =>
    buildSentenceQuestion(st, sentenceTypeForStage(st, st.progress.stage, Math.random), {
      cards: Object.values(cards),
      peers: Object.values(sentences).filter((x) => x.unlocked),
      rand: Math.random,
    });

  function onSentenceAnswer(o: SentenceOutcome) {
    if (!sentenceQ || !sentence || sentenceOutcome) return;
    const responseMs = Math.round(performance.now() - shownAt.current);
    const progress = applySentenceAnswer(
      sentence.progress,
      { correct: o.correct, type: sentenceQ.type, hasReply: Boolean(sentence.reply), responseMs },
      { today: session?.today },
    );
    const updated = { ...sentence, progress };
    setSentences((ss) => ({ ...ss, [sentence.id]: updated }));
    void (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await api<{ progress: Progress }>("/api/sentence-review", {
            body: { sentenceId: sentence.id, mode: mode === "sentences" ? "sentences" : "learn", type: sentenceQ.type, correct: o.correct, answerGiven: o.answerGiven, responseMs, tz: tzOffset() },
          });
          setSentences((ss) => ({ ...ss, [sentence.id]: { ...ss[sentence.id], progress: res.progress } }));
          return;
        } catch {
          // retry once
        }
      }
    })();
    if (!o.correct && !isDone(updated)) {
      const again = sentenceQuestionFor(updated);
      setQueue((qs) => {
        const copy = qs.slice();
        copy.splice(reinsertIndex(pos, copy.length, Math.random), 0, again);
        return copy;
      });
    }
    setSentenceOutcome(o);
    setTotals((t) => (o.correct ? { ...t, correct: t.correct + 1 } : { ...t, wrong: t.wrong + 1 }));
    setRoundLog((l) => [...l, { cardId: sentence.id, correct: o.correct, before: sentence.progress.stage, after: progress.stage }]);
    setAnnounce(o.correct ? "Correct" : "Not quite");
    if (settings.soundEffects && sentenceQ.type !== "sentence_read") playFeedback(o.correct);
  }

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
    // A missed word comes back later in the round — unless it has had enough for today.
    if (!o.correct && !isDone({ ...card, progress })) {
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
    setSentenceOutcome(null);
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
    const ids = nextRoundIds(session.items, (id) => (cards[id] ?? sentences[id]).progress, {
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
        sentences[id]
          ? sentenceQuestionFor(sentences[id])
          : buildQuestion(cards[id], typeFor(cards[id], cards[id].progress), peersByDeck.get(cards[id].deckId) ?? [cards[id]], Math.random),
      ),
    );
    setPos(0);
    setRoundLog([]);
    setPhase("question");
  }

  const sessionTotal = session?.items.length ?? 0;
  const sessionDone = session
    ? session.items.filter((it) => {
        const x = cards[it.id] ?? sentences[it.id];
        return x && isDone(x);
      }).length
    : 0;

  /* ------------------------------- render ------------------------------- */

  if (phase === "done") {
    return (
      <Celebration
        title={title}
        exitHref={exitHref}
        totals={totals}
        cards={Object.values(cards)}
        startStages={startStages}
        sentences={Object.values(sentences)}
        startSentenceStages={startSentenceStages}
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
        <div className="panel animate-pop p-6" data-testid="round-summary">
          <h2 className="text-2xl font-extrabold">Round complete!</h2>
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
              <h3 className="mt-4 font-bold text-success">Moved up a stage</h3>
              <ul className="mt-1 space-y-1">
                {Array.from(new Map(movedUp.map((e) => [e.cardId, e])).values()).map((e) => (
                  <li key={e.cardId} className="flex justify-between gap-2">
                    <span className="font-semibold">{cards[e.cardId]?.term ?? sentences[e.cardId]?.text}</span>
                    <span className="text-sm text-muted">
                      {cards[e.cardId]
                        ? STAGE_NAMES[cards[e.cardId].progress.stage]
                        : SENTENCE_STAGE_NAMES[Math.min(SENTENCE_MASTERED, sentences[e.cardId]?.progress.stage ?? e.after)]}
                    </span>
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
                    {cards[id] ? (
                      <>
                        <b>{cards[id].term}</b> — {cards[id].definition}
                      </>
                    ) : (
                      <b>{sentences[id]?.text}</b>
                    )}
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

  if (sentenceQ && sentence) {
    const sProps = { question: sentenceQ, sentence, answered: sentenceOutcome, onAnswer: onSentenceAnswer };
    return (
      <div className="mx-auto max-w-2xl">
        <SessionHeader title={title} exitHref={exitHref}>
          <span className="chip" data-testid="stage-chip">
            Sentence · {SENTENCE_STAGE_NAMES[Math.min(SENTENCE_MASTERED, sentence.progress.stage)]}
          </span>
        </SessionHeader>
        {session && (
          <>
            <ProgressBar value={sessionDone} max={sessionTotal} label="Today’s progress" />
            <p className="mt-1 text-xs text-muted">
              Today&apos;s progress · question {pos + 1} of {queue.length} in this round
            </p>
          </>
        )}
        <div className="sr-only" aria-live="assertive">
          {announce}
        </div>
        <div className="panel mt-4 p-4 sm:p-6" data-testid="question" data-type={sentenceQ.type} data-sentence-id={sentence.id} key={sentenceQ.key}>
          {sentenceQ.type === "fill_blank" ? (
            <FillBlankQuestion {...sProps} />
          ) : sentenceQ.type === "sentence_read" ? (
            <SentenceReadQuestion {...sProps} />
          ) : sentenceQ.type === "word_order" ? (
            <WordOrderQuestion {...sProps} />
          ) : (
            <QaMatchQuestion {...sProps} />
          )}
          {sentenceOutcome && (
            <SentenceFeedback key={`sfb-${sentenceQ.key}`} sentence={sentence} question={sentenceQ} outcome={sentenceOutcome} onContinue={advance} />
          )}
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
      <div className="panel mt-4 p-4 sm:p-6" data-testid="question" data-type={wordQ.type} data-card-id={card.id} key={wordQ.key}>
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
  sentences,
  startSentenceStages,
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
  sentences: StudySentence[];
  startSentenceStages: Map<string, number>;
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
  const daily = mode === "learn" || mode === "review" || mode === "sentences";
  const sentencesPractised = sentences.filter((x) => sessionIds.has(x.id) && x.progress.dayKey === session?.today).length;
  const sentencesMastered = sentences.filter(
    (x) => x.progress.stage >= SENTENCE_MASTERED && (startSentenceStages.get(x.id) ?? 0) < SENTENCE_MASTERED,
  ).length;
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
      <div className="panel animate-pop mt-6 p-8" data-testid="session-done">
        <div aria-hidden className="text-6xl">
          {empty ? "✨" : "🎉"}
        </div>
        <h1 className="mt-2 text-3xl font-black">
          {daily ? (empty ? "All done for today" : "Done for today!") : "Session complete!"}
        </h1>
        <p className="mt-2 text-muted">
          {empty
            ? mode === "review"
              ? "No words are due right now. Come back later!"
              : mode === "sentences"
                ? "No sentences are ready right now. Sentences unlock when you’ve mastered all the deck words in them — keep learning words, or add sentences in the editor."
                : "Every word here has had its practice for today, or is waiting for its next review."
            : `${totals.correct} of ${total} answers correct${total ? ` (${Math.round((totals.correct / total) * 100)}%)` : ""}.`}
        </p>
        {daily && !empty && (
          <ul className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm" data-testid="day-stats">
            {mode !== "sentences" && <li>📚 {practised} words practised</li>}
            {sentencesPractised > 0 && <li>💬 {sentencesPractised} sentences practised</li>}
            {sentencesMastered > 0 && <li>🌟 {sentencesMastered} sentences mastered</li>}
            <li>⬆️ {steppedUp} words moved up</li>
            <li>🏆 {masteredToday} words mastered today</li>
          </ul>
        )}
        {finishedTopic && (
          <p className="mt-4 rounded-xl bg-success-soft px-4 py-2 font-semibold text-success" data-testid="topic-finished">
            Topic “{finishedTopic}” complete!{topicNow ? ` Next topic: “${topicNow}”.` : ""}
          </p>
        )}
        {daily && (
          <p className="mt-4 text-sm text-muted">
            Come back tomorrow: practising a little every day makes words stick much better than repeating them many
            times in one go.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={exitHref} className="btn-primary">
            Back to {title.length > 24 ? "deck" : title}
          </Link>
          {daily && onKeepGoing && (mode === "learn" || (mode === "sentences" && !empty)) && (
            <button type="button" className="btn-secondary" onClick={onKeepGoing} data-testid="keep-going">
              {finishedTopic && topicNow ? `Start “${topicNow}” now` : "Keep going anyway"}
            </button>
          )}
          <Link href="/" className="btn-ghost">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
