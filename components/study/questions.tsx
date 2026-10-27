"use client";

import { useEffect, useRef, useState } from "react";
import { checkAnswer, diffSegments, type Verdict } from "@/lib/answer-check";
import { isTypingTarget } from "@/lib/client/keys";
import { langDir } from "@/lib/languages";
import type { Question, StudyCard } from "@/lib/learn";
import { gradeFor, type Grade } from "@/lib/srs";
import { AudioButton, useSpeak } from "../audio";
import { CardImage } from "../card-image";
import { useApp } from "../providers";
import { SpecialCharsBar } from "../ui";

export type Outcome = {
  correct: boolean;
  grade: Grade;
  answerGiven: string;
  verdict?: Verdict;
};

export type QuestionProps = {
  question: Question;
  card: StudyCard;
  /** Set once the learner has answered (locks the UI and shows the result styling). */
  answered: Outcome | null;
  onAnswer: (o: Outcome) => void;
};

function useKey(handler: (e: KeyboardEvent) => void, active = true) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    const fn = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [active]);
}

/** Tracks how long the current question has been visible. */
function useTimer(key: string) {
  const start = useRef(0);
  useEffect(() => {
    start.current = performance.now();
  }, [key]);
  return () => Math.round(performance.now() - start.current);
}

function Prompt({ card, show }: { card: StudyCard; show: "term" | "definition" | "audio" }) {
  const speak = useSpeak();
  const { settings } = useApp();
  useEffect(() => {
    if (show === "audio") void speak(card.term, card.termLang, { auto: true });
    else if (show === "term" && settings.autoPlayTerm) void speak(card.term, card.termLang, { auto: true });
    else if (show === "definition" && settings.autoPlayDefinition)
      void speak(card.definition, card.definitionLang, { auto: true });
    // Play once per card/prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, show]);

  useKey((e) => {
    if (isTypingTarget(e.target)) return;
    if (e.key === "p" || e.key === "P" || (e.key === " " && show !== "definition")) {
      e.preventDefault();
      if (show === "definition") void speak(card.definition, card.definitionLang);
      else void speak(card.term, card.termLang);
    }
  });

  if (show === "audio") {
    return (
      <div className="flex flex-col items-center gap-3 py-4" data-testid="prompt-audio">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Listen</p>
        <div className="flex items-center gap-3">
          <AudioButton text={card.term} lang={card.termLang} size="lg" label="Play the word again" />
          <AudioButton text={card.term} lang={card.termLang} size="lg" slow label="Play the word slowly" />
        </div>
      </div>
    );
  }
  if (show === "term") {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Term</p>
        <div className="flex items-center gap-2">
          <p className="text-3xl font-bold sm:text-4xl" dir={langDir(card.termLang)} lang={card.termLang} data-testid="prompt-term">
            {card.term}
          </p>
          <AudioButton text={card.term} lang={card.termLang} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center sm:flex-row sm:justify-center sm:text-left">
      <CardImage src={card.imageUrl} alt={card.definition} term={card.term} className="h-28 w-28 sm:h-36 sm:w-36" hideIfMissing />
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Definition</p>
        <div className="flex items-center justify-center gap-2 sm:justify-start">
          <p className="text-2xl font-bold sm:text-3xl" dir={langDir(card.definitionLang)} data-testid="prompt-definition">
            {card.definition}
          </p>
          <AudioButton text={card.definition} lang={card.definitionLang} />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Multiple choice ----------------------------- */

export function MultipleChoiceQuestion({ question, card, answered, onAnswer }: QuestionProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const elapsed = useTimer(question.key);
  const options = question.options ?? [];
  const optionLang = question.type === "mc" ? card.definitionLang : card.termLang;

  const choose = (opt: string) => {
    if (answered) return;
    setPicked(opt);
    const correct = opt === question.answer;
    onAnswer({ correct, grade: gradeFor(correct ? "correct" : "wrong", elapsed()), answerGiven: opt });
  };

  useKey((e) => {
    if (answered || isTypingTarget(e.target)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= options.length) {
      e.preventDefault();
      choose(options[n - 1]);
    }
  });

  return (
    <div>
      <Prompt card={card} show={question.type === "mc" ? "term" : question.type === "listen_mc" ? "audio" : "definition"} />
      <p className="mb-3 text-center text-sm font-semibold text-muted">
        {question.type === "mc" ? "Choose the matching definition" : "Choose the matching term"}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2" role="list">
        {options.map((opt, i) => {
          const isAnswer = opt === question.answer;
          const state = answered ? (isAnswer ? "correct" : opt === picked ? "wrong" : "idle") : "idle";
          return (
            <li key={opt}>
              <button
                type="button"
                onClick={() => choose(opt)}
                disabled={Boolean(answered)}
                dir={langDir(optionLang)}
                lang={optionLang}
                data-testid="mc-option"
                data-correct={answered ? String(isAnswer) : undefined}
                className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-lg font-medium transition-colors ${
                  state === "correct"
                    ? "border-success bg-success-soft"
                    : state === "wrong"
                      ? "animate-shake border-danger bg-danger-soft"
                      : "border-line bg-surface hover:border-accent disabled:opacity-60"
                }`}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold text-muted" aria-hidden>
                  {i + 1}
                </span>
                <span className="min-w-0 break-words">{opt}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* --------------------------------- Writing --------------------------------- */

export function WriteQuestion({ question, card, answered, onAnswer }: QuestionProps) {
  const { settings } = useApp();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const elapsed = useTimer(question.key);
  const listen = question.type === "dictation";

  useEffect(() => {
    inputRef.current?.focus();
  }, [question.key]);

  const submit = (dontKnow = false) => {
    if (answered) return;
    if (dontKnow) {
      onAnswer({ correct: false, grade: 1, answerGiven: "", verdict: "wrong" });
      return;
    }
    if (!value.trim()) {
      inputRef.current?.focus();
      return;
    }
    const res = checkAnswer(value, card.term, {
      strictAccents: settings.strictAccents,
      ignoreArticles: settings.ignoreArticles,
      lang: card.termLang,
    });
    const grade: Grade = res.verdict === "correct" ? gradeFor("correct", elapsed()) : res.correct ? 3 : 1;
    onAnswer({ correct: res.correct, grade, answerGiven: value, verdict: res.verdict });
  };

  return (
    <div>
      <Prompt card={card} show={listen ? "audio" : "definition"} />
      <form
        className="mx-auto mt-4 max-w-xl space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="answer" className="label">
          {listen ? "Type what you hear" : "Type the term"}
        </label>
        <input
          id="answer"
          ref={inputRef}
          className={`input text-xl ${answered ? (answered.correct ? "border-success" : "border-danger") : ""}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={Boolean(answered)}
          dir={langDir(card.termLang)}
          lang={card.termLang}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-testid="answer-input"
        />
        {!answered && <SpecialCharsBar lang={card.termLang} inputRef={inputRef} onInsert={setValue} />}
        {!answered && (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary flex-1" data-testid="submit-answer">
              Check
            </button>
            <button type="button" className="btn-secondary" onClick={() => submit(true)}>
              Don&apos;t know
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

/* ------------------------------- Flashcard ------------------------------- */

/** The example sentence stays folded away until you want it. */
export function ExampleToggle({ card }: { card: StudyCard }) {
  const [open, setOpen] = useState(false);
  if (!card.example) return null;
  return open ? (
    <div className="max-w-md text-center" onClick={(e) => e.stopPropagation()} data-testid="example">
      <p className="flex items-center justify-center gap-1 italic" dir={langDir(card.termLang)} lang={card.termLang}>
        “{card.example}”
        <AudioButton text={card.example} lang={card.termLang} size="sm" label="Play the example" />
      </p>
      {card.exampleTranslation && <p className="text-sm text-muted">{card.exampleTranslation}</p>}
    </div>
  ) : (
    <button
      type="button"
      className="rounded-lg px-3 py-1 text-sm font-semibold text-accent hover:bg-accent-soft"
      onClick={(e) => {
        e.stopPropagation();
        setOpen(true);
      }}
      data-testid="show-example"
    >
      Example ▸
    </button>
  );
}

export function FlipCard({
  card,
  flipped,
  onFlip,
  reverse = false,
}: {
  card: StudyCard;
  flipped: boolean;
  onFlip: () => void;
  reverse?: boolean;
}) {
  const termFace = (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-[2rem] font-bold leading-tight sm:text-5xl" dir={langDir(card.termLang)} lang={card.termLang} data-testid="flashcard-term">
        {card.term}
      </p>
      <AudioButton text={card.term} lang={card.termLang} size="lg" />
    </div>
  );
  const defFace = (
    <div className="flex h-full flex-col items-center justify-center gap-3 overflow-auto p-5 text-center">
      <CardImage
        src={card.imageUrl}
        alt={card.definition}
        term={card.term}
        attribution={card.imageAttribution}
        showAttribution
        hideIfMissing
        className="h-32 w-full max-w-60 sm:h-40"
      />
      <div className="flex items-center gap-2">
        <p className="text-2xl font-bold sm:text-3xl" dir={langDir(card.definitionLang)} data-testid="flashcard-definition">
          {card.definition}
        </p>
        <AudioButton text={card.definition} lang={card.definitionLang} />
      </div>
      {card.example && <ExampleToggle card={card} />}
    </div>
  );
  return (
    <div className="flip-scene">
      <div
        role="button"
        tabIndex={0}
        aria-label={flipped ? "Card back. Activate to flip to the front" : "Card front. Activate to flip"}
        onClick={onFlip}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onFlip();
          }
        }}
        className={`flip-card h-80 w-full cursor-pointer select-none sm:h-96 ${flipped ? "is-flipped" : ""}`}
        data-testid="flashcard"
        data-flipped={flipped}
      >
        <div className="flip-face panel" inert={flipped}>
          {reverse ? defFace : termFace}
        </div>
        <div className="flip-face flip-back panel" inert={!flipped}>
          {reverse ? termFace : defFace}
        </div>
      </div>
    </div>
  );
}

/** Stage-0 "new card" question: view front and back, then continue. */
export function NewCardQuestion({ card, onAnswer, answered }: QuestionProps) {
  const [flipped, setFlipped] = useState(false);
  const { settings } = useApp();
  const speak = useSpeak();
  useEffect(() => {
    if (settings.autoPlayTerm) void speak(card.term, card.termLang, { auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);
  useKey((e) => {
    if (isTypingTarget(e.target)) return;
    if (e.key === " ") {
      e.preventDefault();
      setFlipped((f) => !f);
    }
  });
  return (
    <div className="space-y-4">
      <p className="text-center text-sm font-semibold uppercase tracking-wide text-accent">New word</p>
      <FlipCard
        card={card}
        flipped={flipped}
        onFlip={() => {
          setFlipped((f) => !f);
          if (!flipped && settings.autoPlayDefinition) void speak(card.definition, card.definitionLang);
        }}
      />
      {!answered && (
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => (flipped ? onAnswer({ correct: true, grade: 4, answerGiven: "" }) : setFlipped(true))}
          data-testid="got-it"
        >
          {flipped ? "Got it — continue" : "Show the meaning"}
        </button>
      )}
    </div>
  );
}

/* -------------------------------- Feedback -------------------------------- */

export function Feedback({
  card,
  outcome,
  onOverride,
  onContinue,
}: {
  card: StudyCard;
  outcome: Outcome;
  onOverride?: () => void;
  onContinue: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  // No sound here: the word was already played when the question appeared, and replaying it
  // after answering would clash with the next word's audio. The 🔊 button replays on demand.
  useEffect(() => {
    btnRef.current?.focus();
  }, []);
  useKey((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onContinue();
    }
  });
  const v = outcome.verdict;
  const title = outcome.correct
    ? v === "accent"
      ? "Almost — watch the accents"
      : v === "typo"
        ? "Counted as correct"
        : "Correct!"
    : v === "typo"
      ? "Almost right"
      : v === "accent"
        ? "Almost — watch the accents"
        : "Not quite";
  return (
    <div
      className={`animate-pop mt-6 rounded-2xl border-2 p-4 ${outcome.correct ? "border-success bg-success-soft" : "border-danger bg-danger-soft"}`}
      data-testid="feedback"
      data-correct={outcome.correct}
    >
      <p className={`flex items-center gap-2 text-lg font-bold ${outcome.correct ? "text-success" : "text-danger"}`}>
        <span aria-hidden>{outcome.correct ? "✓" : "✗"}</span> {title}
      </p>
      {(!outcome.correct || v === "accent" || v === "typo") && (
        <div className="mt-2">
          <p className="text-sm text-muted">Correct answer</p>
          <p className="flex items-center gap-2 text-2xl font-bold" dir={langDir(card.termLang)} lang={card.termLang}>
            <span data-testid="correct-answer">
              {v === "typo" || v === "accent"
                ? diffSegments(outcome.answerGiven, card.term).map((s, i) => (
                    <span key={i} className={s.ok ? "" : "rounded bg-warning-soft px-0.5 text-warning underline"}>
                      {s.text}
                    </span>
                  ))
                : card.term}
            </span>
            <AudioButton text={card.term} lang={card.termLang} size="sm" />
          </p>
          <p className="text-sm text-muted">{card.definition}</p>
          <div className="mt-1">
            <ExampleToggle card={card} />
          </div>
          {outcome.answerGiven && !outcome.correct && (
            <p className="mt-1 text-sm">
              You wrote: <span className="line-through">{outcome.answerGiven}</span>
            </p>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {onOverride && !outcome.correct && (
          <button type="button" className="btn-secondary" onClick={onOverride} data-testid="override">
            I was right
          </button>
        )}
        <button ref={btnRef} type="button" className="btn-primary flex-1" onClick={onContinue} data-testid="continue">
          Continue <span className="hidden text-xs opacity-75 sm:inline">(Enter)</span>
        </button>
      </div>
    </div>
  );
}
