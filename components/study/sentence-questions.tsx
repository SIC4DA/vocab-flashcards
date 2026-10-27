"use client";

import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/client/keys";
import { langDir } from "@/lib/languages";
import { normWord, orderCorrect, SENTENCE_LABELS, type SentenceQuestion, type StudySentence } from "@/lib/sentences";
import { AudioButton, useSpeak } from "../audio";
import { useApp } from "../providers";

export type SentenceOutcome = { correct: boolean; answerGiven: string };

type Props = {
  question: SentenceQuestion;
  sentence: StudySentence;
  answered: SentenceOutcome | null;
  onAnswer: (o: SentenceOutcome) => void;
};

function useKeys(handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const fn = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
}

function Heading({ type }: { type: SentenceQuestion["type"] }) {
  return (
    <p className="text-center text-sm font-semibold uppercase tracking-wide text-accent" data-testid="sentence-heading">
      {SENTENCE_LABELS[type]}
    </p>
  );
}

function Translation({ sentence }: { sentence: StudySentence }) {
  if (!sentence.translation) return null;
  return (
    <p className="text-center text-muted" dir={langDir(sentence.definitionLang)}>
      {sentence.translation}
    </p>
  );
}

/* ---------------------------- Fill in the blank ---------------------------- */

export function FillBlankQuestion({ question, sentence, answered, onAnswer }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const options = question.options ?? [];
  const choose = (opt: string) => {
    if (answered) return;
    setPicked(opt);
    onAnswer({ correct: normWord(opt) === normWord(question.answer ?? ""), answerGiven: opt });
  };
  useKeys((e) => {
    if (answered || isTypingTarget(e.target)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= options.length) {
      e.preventDefault();
      choose(options[n - 1]);
    }
  });
  const parts = (question.blanked ?? "").split("___");
  return (
    <div className="space-y-4">
      <Heading type="fill_blank" />
      {question.context && (
        <p className="text-center text-lg font-semibold text-muted" lang={sentence.termLang} data-testid="blank-context">
          {question.context} →
        </p>
      )}
      <p className="text-center text-2xl font-bold leading-relaxed sm:text-3xl" dir={langDir(sentence.termLang)} lang={sentence.termLang} data-testid="blanked-sentence">
        {parts[0]}
        <span className={`mx-1 inline-block min-w-16 border-b-4 px-1 ${answered ? (answered.correct ? "border-success text-success" : "border-danger text-danger") : "border-accent"}`}>
          {answered ? question.answer : " "}
        </span>
        {parts[1]}
      </p>
      {question.context ? (
        question.blankTranslation ? <p className="text-center text-muted">{question.blankTranslation}</p> : null
      ) : (
        <Translation sentence={sentence} />
      )}
      <ul className="grid gap-3 sm:grid-cols-3">
        {options.map((opt, i) => {
          const isAnswer = normWord(opt) === normWord(question.answer ?? "");
          const state = answered ? (isAnswer ? "correct" : opt === picked ? "wrong" : "idle") : "idle";
          return (
            <li key={opt}>
              <button
                type="button"
                disabled={Boolean(answered)}
                onClick={() => choose(opt)}
                lang={sentence.termLang}
                data-testid="blank-option"
                className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-lg font-semibold ${
                  state === "correct" ? "border-success bg-success-soft" : state === "wrong" ? "animate-shake border-danger bg-danger-soft" : "border-line bg-surface hover:border-accent"
                }`}
              >
                <span className="text-sm text-muted" aria-hidden>
                  {i + 1}
                </span>
                {opt}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------------------- Sentence card ---------------------------- */

export function SentenceReadQuestion({ sentence, answered, onAnswer }: Props) {
  const [shown, setShown] = useState(false);
  const speak = useSpeak();
  const { settings } = useApp();
  useEffect(() => {
    if (settings.autoPlayTerm) void speak(sentence.text, sentence.termLang, { auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence.id]);
  return (
    <div className="space-y-4 text-center">
      <Heading type="sentence_read" />
      <div className="flex items-center justify-center gap-2">
        <p className="text-2xl font-bold sm:text-3xl" dir={langDir(sentence.termLang)} lang={sentence.termLang} data-testid="read-sentence">
          {sentence.text}
        </p>
        <AudioButton text={sentence.text} lang={sentence.termLang} />
        <AudioButton text={sentence.text} lang={sentence.termLang} slow />
      </div>
      {shown ? (
        <p className="text-lg text-muted" dir={langDir(sentence.definitionLang)} data-testid="read-translation">
          {sentence.translation || "No translation saved for this sentence."}
        </p>
      ) : (
        <button type="button" className="btn-ghost text-accent" onClick={() => setShown(true)} data-testid="show-translation">
          Show translation
        </button>
      )}
      {!answered && (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn-secondary" onClick={() => onAnswer({ correct: false, answerGiven: "not yet" })} data-testid="read-not-yet">
            Not yet
          </button>
          <button type="button" className="btn-primary" onClick={() => onAnswer({ correct: true, answerGiven: "understood" })} data-testid="read-understood">
            I understood it
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Word order ---------------------------- */

export function WordOrderQuestion({ question, sentence, answered, onAnswer }: Props) {
  const chunks = question.chunks ?? [];
  const [placed, setPlaced] = useState<number[]>([]);
  const remaining = chunks.map((c, i) => ({ c, i })).filter((x) => !placed.includes(x.i));
  const check = () => {
    if (answered || placed.length !== chunks.length) return;
    const given = placed.map((i) => chunks[i]);
    onAnswer({ correct: orderCorrect(given, question.solution ?? []), answerGiven: given.join(" ") });
  };
  useKeys((e) => {
    if (e.key === "Enter" && !answered && placed.length === chunks.length) {
      e.preventDefault();
      check();
    }
    if (e.key === "Backspace" && !answered && !isTypingTarget(e.target)) setPlaced((p) => p.slice(0, -1));
  });
  return (
    <div className="space-y-4">
      <Heading type="word_order" />
      <p className="text-center text-sm font-semibold text-muted">Tap the words in the right order</p>
      <Translation sentence={sentence} />
      <div
        className={`flex min-h-16 flex-wrap items-center gap-2 rounded-xl border-2 border-dashed p-3 ${
          answered ? (answered.correct ? "border-success bg-success-soft" : "border-danger bg-danger-soft") : "border-line"
        }`}
        dir={langDir(sentence.termLang)}
        data-testid="order-answer"
        aria-label="Your sentence"
      >
        {placed.length === 0 && <span className="text-sm text-muted">Your sentence appears here</span>}
        {placed.map((i) => (
          <button
            key={i}
            type="button"
            disabled={Boolean(answered)}
            onClick={() => setPlaced((p) => p.filter((x) => x !== i))}
            className="min-h-11 rounded-lg bg-accent px-3 text-lg font-semibold text-on-accent"
            data-testid="order-placed"
          >
            {chunks[i]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2" dir={langDir(sentence.termLang)} lang={sentence.termLang}>
        {remaining.map(({ c, i }) => (
          <button
            key={i}
            type="button"
            disabled={Boolean(answered)}
            onClick={() => setPlaced((p) => [...p, i])}
            className="min-h-11 rounded-lg border-2 border-line bg-surface px-3 text-lg font-semibold hover:border-accent"
            data-testid="order-chunk"
          >
            {c}
          </button>
        ))}
      </div>
      {!answered && (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => setPlaced([])} disabled={placed.length === 0}>
            Clear
          </button>
          <button type="button" className="btn-primary flex-1" onClick={check} disabled={placed.length !== chunks.length} data-testid="order-check">
            Check
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Question & answer ---------------------------- */

export function QaMatchQuestion(props: Props) {
  return props.question.options?.length ? <QaPickReply {...props} /> : <QaMatchBoard {...props} />;
}

/** With a single question/reply pair: choose the right reply. */
function QaPickReply({ question, sentence, answered, onAnswer }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const options = question.options ?? [];
  const choose = (opt: string) => {
    if (answered) return;
    setPicked(opt);
    onAnswer({ correct: normWord(opt) === normWord(question.answer ?? ""), answerGiven: opt });
  };
  useKeys((e) => {
    if (answered || isTypingTarget(e.target)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= options.length) {
      e.preventDefault();
      choose(options[n - 1]);
    }
  });
  return (
    <div className="space-y-4">
      <Heading type="qa_match" />
      <div className="flex items-center justify-center gap-2">
        <p className="text-center text-2xl font-bold" lang={sentence.termLang} dir={langDir(sentence.termLang)} data-testid="qa-prompt">
          {sentence.text}
        </p>
        <AudioButton text={sentence.text} lang={sentence.termLang} />
      </div>
      <p className="text-center text-sm font-semibold text-muted">Choose the right reply</p>
      <ul className="space-y-2" lang={sentence.termLang}>
        {options.map((opt, i) => {
          const isAnswer = normWord(opt) === normWord(question.answer ?? "");
          const state = answered ? (isAnswer ? "correct" : opt === picked ? "wrong" : "idle") : "idle";
          return (
            <li key={opt}>
              <button
                type="button"
                disabled={Boolean(answered)}
                onClick={() => choose(opt)}
                data-testid="qa-option"
                className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-lg ${
                  state === "correct" ? "border-success bg-success-soft" : state === "wrong" ? "animate-shake border-danger bg-danger-soft" : "border-line bg-surface hover:border-accent"
                }`}
              >
                <span className="text-sm text-muted" aria-hidden>
                  {i + 1}
                </span>
                {opt}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Several pairs: tap a question, then its reply. */
function QaMatchBoard({ question, sentence, answered, onAnswer }: Props) {
  const pairs = question.pairs ?? [];
  // Replies in a different order from the questions (rotated and reversed).
  const answers = pairs.length > 1 ? [...pairs.slice(1), pairs[0]].reverse() : pairs;
  const [selected, setSelected] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrongFlash, setWrongFlash] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);

  function pickAnswer(id: string) {
    if (answered || !selected) return;
    if (id === selected) {
      const next = [...matched, id];
      setMatched(next);
      setSelected(null);
      if (next.length === pairs.length) {
        // Graded on this sentence's own pair: matched without a mistake on it.
        onAnswer({ correct: mistakes === 0, answerGiven: `${mistakes} mistakes` });
      }
    } else {
      setMistakes((m) => m + (selected === sentence.id ? 1 : 0));
      setWrongFlash(id);
      setTimeout(() => setWrongFlash(null), 400);
    }
  }

  return (
    <div className="space-y-4">
      <Heading type="qa_match" />
      <p className="text-center text-sm font-semibold text-muted">Match each question with its reply</p>
      <div className="grid grid-cols-2 gap-3" lang={sentence.termLang} dir={langDir(sentence.termLang)}>
        <ul className="space-y-2" aria-label="Questions">
          {pairs.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={matched.includes(p.id) || Boolean(answered)}
                aria-pressed={selected === p.id}
                onClick={() => setSelected(p.id)}
                data-testid="qa-question"
                data-pair={p.id}
                className={`min-h-14 w-full rounded-xl border-2 px-3 py-2 text-left font-semibold ${
                  matched.includes(p.id) ? "border-success bg-success-soft opacity-70" : selected === p.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"
                }`}
              >
                {p.question}
              </button>
            </li>
          ))}
        </ul>
        <ul className="space-y-2" aria-label="Replies">
          {answers.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={matched.includes(p.id) || Boolean(answered)}
                onClick={() => pickAnswer(p.id)}
                data-testid="qa-answer"
                data-pair={p.id}
                className={`min-h-14 w-full rounded-xl border-2 px-3 py-2 text-left ${
                  matched.includes(p.id) ? "border-success bg-success-soft opacity-70" : wrongFlash === p.id ? "animate-shake border-danger bg-danger-soft" : "border-line bg-surface hover:border-accent"
                }`}
              >
                {p.answer}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------- Feedback ---------------------------- */

export function SentenceFeedback({
  sentence,
  question,
  outcome,
  onContinue,
}: {
  sentence: StudySentence;
  question: SentenceQuestion;
  outcome: SentenceOutcome;
  onContinue: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  // No sound here: the word was already played when the question appeared, and replaying it
  // after answering would clash with the next word's audio. The 🔊 button replays on demand.
  useEffect(() => {
    btnRef.current?.focus();
  }, []);
  useKeys((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onContinue();
    }
  });
  const read = question.type === "sentence_read";
  return (
    <div
      className={`animate-pop mt-6 rounded-2xl border-2 p-4 ${outcome.correct ? "border-success bg-success-soft" : read ? "border-line bg-surface-2" : "border-danger bg-danger-soft"}`}
      data-testid="feedback"
      data-correct={outcome.correct}
    >
      <p className={`text-lg font-bold ${outcome.correct ? "text-success" : read ? "text-fg" : "text-danger"}`}>
        {outcome.correct ? "✓ Correct!" : read ? "No problem — you’ll see it again soon." : "✗ Not quite"}
      </p>
      <p className="mt-2 flex items-center gap-2 text-xl font-bold" dir={langDir(sentence.termLang)} lang={sentence.termLang} data-testid="sentence-solution">
        {sentence.text}
        <AudioButton text={sentence.text} lang={sentence.termLang} size="sm" />
      </p>
      {sentence.translation && <p className="text-sm text-muted">{sentence.translation}</p>}
      {question.type === "qa_match" && sentence.reply && (
        <p className="mt-1 text-sm">
          → <b lang={sentence.termLang}>{sentence.reply}</b>
          {sentence.replyTranslation ? <span className="text-muted"> ({sentence.replyTranslation})</span> : null}
        </p>
      )}
      <button ref={btnRef} type="button" className="btn-primary mt-4 w-full" onClick={onContinue} data-testid="continue">
        Continue <span className="hidden text-xs opacity-75 sm:inline">(Enter)</span>
      </button>
    </div>
  );
}
