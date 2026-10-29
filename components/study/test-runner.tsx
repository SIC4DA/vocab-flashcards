"use client";

import { useRef, useState } from "react";
import { checkAnswer } from "@/lib/answer-check";
import { api, ApiClientError, tzOffset } from "@/lib/client/api";
import { playCelebration } from "@/lib/client/sounds";
import { langDir } from "@/lib/languages";
import { QUESTION_LABELS, type Question, type StudyCard, type TestType } from "@/lib/learn";
import type { Grade } from "@/lib/srs";
import { AudioButton } from "../audio";
import { CardImage } from "../card-image";
import { useApp, useToast } from "../providers";
import { SpecialCharsBar, Spinner } from "../ui";
import type { QueuePayload } from "./session";
import { postReview, SessionHeader, useEscToExit } from "./session";

const TYPE_OPTIONS: { type: TestType; label: string }[] = [
  { type: "mc", label: "Multiple choice" },
  { type: "write", label: "Write" },
  { type: "dictation", label: "Listen & write" },
  { type: "true_false", label: "True / False" },
];

type Answer = { text: string };
type Result = { q: Question; card: StudyCard; given: string; correct: boolean };

export function TestRunner({ deckId, cardCount, title, exitHref }: { deckId: string; cardCount: number; title: string; exitHref: string }) {
  const { settings } = useApp();
  const toast = useToast();
  const minCount = Math.min(5, cardCount);
  const [count, setCount] = useState(Math.min(10, cardCount));
  const [types, setTypes] = useState<Set<TestType>>(new Set(["mc", "write", "dictation", "true_false"]));
  const [loading, setLoading] = useState(false);
  const [test, setTest] = useState<{ questions: Question[]; cards: Record<string, StudyCard> } | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [results, setResults] = useState<Result[] | null>(null);

  useEscToExit(exitHref, Boolean(test) && !results);

  async function start(cardIds?: string[]) {
    setLoading(true);
    try {
      const chosen = [...types];
      const params = new URLSearchParams({
        deckId,
        mode: "test",
        count: String(cardIds ? cardIds.length : count),
        types: (chosen.length ? chosen : ["write"]).join(","),
        tz: String(tzOffset()),
      });
      if (cardIds) params.set("cardIds", cardIds.join(","));
      const data = await api<QueuePayload>(`/api/study/queue?${params}`);
      // Tests only contain word questions.
      setTest({ questions: data.questions.filter((q): q is Question => "cardId" in q), cards: Object.fromEntries(data.cards.map((c) => [c.id, c])) });
      setAnswers({});
      setResults(null);
      window.scrollTo({ top: 0 });
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Couldn't build the test", { kind: "error" });
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    if (!test) return;
    const out: Result[] = test.questions.map((q) => {
      const card = test.cards[q.cardId];
      const a = answers[q.key] ?? { text: "" };
      let correct = false;
      let grade: Grade = 1;
      if (q.type === "mc" || q.type === "true_false") {
        correct = a.text === q.answer;
        grade = correct ? 4 : 1;
      } else {
        const r = checkAnswer(a.text, card.term, {
          strictAccents: settings.strictAccents,
          ignoreArticles: settings.ignoreArticles,
          lang: card.termLang,
        });
        correct = r.correct;
        grade = r.verdict === "correct" ? 4 : r.correct ? 3 : 1;
      }
      void postReview({
        cardId: q.cardId,
        mode: "test",
        questionType: q.type,
        correct,
        grade,
        answerGiven: a.text,
        responseMs: 0,
      });
      return { q, card, given: a.text, correct };
    });
    setResults(out);
    const pct = Math.round((out.filter((r) => r.correct).length / out.length) * 100);
    if (pct >= settings.passMark && settings.soundEffects) playCelebration();
    window.scrollTo({ top: 0 });
  }

  /* ----------------------------- options ----------------------------- */
  if (!test) {
    return (
      <div className="mx-auto max-w-xl">
        <SessionHeader title={title} exitHref={exitHref} />
        <form
          className="panel space-y-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
          data-testid="test-options"
        >
          <h2 className="text-2xl font-semibold">Create a test</h2>
          <div>
            <label htmlFor="test-count" className="label">
              Number of questions ({minCount}–{cardCount})
            </label>
            <input
              id="test-count"
              type="number"
              min={minCount}
              max={cardCount}
              className="input w-32"
              value={count}
              onChange={(e) => setCount(Math.max(minCount, Math.min(cardCount, Number(e.target.value) || minCount)))}
            />
          </div>
          <fieldset>
            <legend className="label">Question types</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TYPE_OPTIONS.map((o) => {
                return (
                  <label key={o.type} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[var(--accent)]"
                      checked={types.has(o.type)}
                      onChange={(e) =>
                        setTypes((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(o.type);
                          else n.delete(o.type);
                          return n;
                        })
                      }
                      data-testid={`test-type-${o.type}`}
                    />
                    {o.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button type="submit" className="btn-primary w-full" disabled={loading || types.size === 0} data-testid="start-test">
            {loading ? <Spinner label="Building test" /> : "Start test"}
          </button>
        </form>
      </div>
    );
  }

  /* ----------------------------- results ----------------------------- */
  if (results) {
    const score = results.filter((r) => r.correct).length;
    const pct = Math.round((score / results.length) * 100);
    const passed = pct >= settings.passMark;
    const missed = results.filter((r) => !r.correct);
    return (
      <div className="mx-auto max-w-2xl">
        <SessionHeader title={title} exitHref={exitHref} />
        <div className="index-card animate-pop px-6 pb-6 pt-4 text-center" data-testid="test-results">
          <p className={`headword text-[3.6rem] leading-none tabular-nums ${passed ? "text-success" : "text-danger"}`} data-testid="test-score">
            {pct}%
          </p>
          <p className={`mt-3 text-xl font-semibold ${passed ? "text-success" : "text-danger"}`} data-testid="test-verdict">
            {passed ? "Passed" : "Failed"} <span className="text-sm font-medium text-muted">(pass mark {settings.passMark}%)</span>
          </p>
          <p className="mt-1 text-muted">
            {score} of {results.length} correct
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {missed.length > 0 && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => start(Array.from(new Set(missed.map((m) => m.q.cardId))))}
                data-testid="retake-missed"
              >
                Retake with missed only ({missed.length})
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setTest(null)}>
              New test
            </button>
          </div>
        </div>
        <ol className="mt-6 space-y-3">
          {results.map((r, i) => (
            <li
              key={r.q.key}
              className={`panel border-l-4 p-4 ${r.correct ? "border-l-success" : "border-l-danger"}`}
              data-testid="test-result-row"
              data-correct={r.correct}
            >
              <p className="text-xs text-muted">
                {i + 1}. {QUESTION_LABELS[r.q.type]} · {r.correct ? "✓ correct" : "✗ incorrect"}
              </p>
              <p className="mt-1">
                <b dir={langDir(r.card.termLang)}>{r.card.term}</b> — {r.card.definition}
              </p>
              {r.q.type === "true_false" && <p className="text-sm text-muted">Shown: {r.q.shownDefinition}</p>}
              <p className="mt-1 text-sm">
                Your answer: <span className={r.correct ? "text-success" : "text-danger"}>{r.given || "—"}</span>
                {!r.correct && (
                  <>
                    {" "}
                    · Correct: <b>{r.q.answer}</b>
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  /* ----------------------------- questions ----------------------------- */
  const answeredCount = test.questions.filter((q) => (answers[q.key]?.text ?? "").trim()).length;
  return (
    <div className="mx-auto max-w-2xl">
      <SessionHeader title={title} exitHref={exitHref}>
        <span className="chip">
          {answeredCount} / {test.questions.length} answered
        </span>
      </SessionHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        {test.questions.map((q, i) => (
          <TestQuestion
            key={q.key}
            index={i}
            q={q}
            card={test.cards[q.cardId]}
            answer={answers[q.key]}
            onChange={(a) => setAnswers((s) => ({ ...s, [q.key]: a }))}
          />
        ))}
        <button type="submit" className="btn-primary w-full" data-testid="submit-test">
          Submit test
        </button>
      </form>
    </div>
  );
}

function TestQuestion({
  index,
  q,
  card,
  answer,
  onChange,
}: {
  index: number;
  q: Question;
  card: StudyCard;
  answer: Answer | undefined;
  onChange: (a: Answer) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const name = `q-${q.key}`;
  const heading = (
    <p className="text-xs text-muted">
      {index + 1}. {QUESTION_LABELS[q.type]}
    </p>
  );
  const typed = (label: string) => (
    <div className="mt-3 space-y-2">
      <label htmlFor={name} className="sr-only">
        {label}
      </label>
      <input
        id={name}
        ref={inputRef}
        className="input"
        placeholder={label}
        value={answer?.text ?? ""}
        onChange={(e) => onChange({ text: e.target.value })}
        dir={langDir(card.termLang)}
        lang={card.termLang}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        data-testid="test-input"
      />
      <SpecialCharsBar lang={card.termLang} inputRef={inputRef} onInsert={(v) => onChange({ text: v })} />
    </div>
  );

  return (
    <fieldset className="panel p-4" data-testid="test-question" data-type={q.type} data-card-id={card.id}>
      <legend className="sr-only">Question {index + 1}</legend>
      {heading}
      {q.type === "mc" && (
        <>
          <p className="mt-1 flex items-center gap-2 text-xl font-bold" dir={langDir(card.termLang)}>
            {card.term} <AudioButton text={card.term} lang={card.termLang} size="sm" />
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup">
            {q.options?.map((opt) => (
              <label
                key={opt}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${
                  answer?.text === opt ? "border-accent bg-accent-soft" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name={name}
                  className="h-5 w-5 accent-[var(--accent)]"
                  checked={answer?.text === opt}
                  onChange={() => onChange({ text: opt })}
                  data-testid="test-option"
                />
                <span dir={langDir(card.definitionLang)}>{opt}</span>
              </label>
            ))}
          </div>
        </>
      )}
      {q.type === "true_false" && (
        <>
          <p className="mt-1 text-lg">
            <b dir={langDir(card.termLang)}>{card.term}</b> means <b dir={langDir(card.definitionLang)}>{q.shownDefinition}</b>
          </p>
          <div className="mt-3 flex gap-3" role="radiogroup">
            {["True", "False"].map((v) => (
              <label
                key={v}
                className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border ${
                  answer?.text === v ? "border-accent bg-accent-soft" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name={name}
                  className="h-5 w-5 accent-[var(--accent)]"
                  checked={answer?.text === v}
                  onChange={() => onChange({ text: v })}
                  data-testid={`test-tf-${v.toLowerCase()}`}
                />
                {v}
              </label>
            ))}
          </div>
        </>
      )}
      {q.type === "write" && (
        <>
          <div className="mt-2 flex items-center gap-3">
            <CardImage src={card.imageUrl} alt={card.definition} term={card.term} className="h-16 w-16" hideIfMissing />
            <p className="text-lg font-bold" dir={langDir(card.definitionLang)}>
              {card.definition}
            </p>
          </div>
          {typed("Type the term")}
        </>
      )}
      {q.type === "dictation" && (
        <>
          <div className="mt-2 flex items-center gap-2">
            <AudioButton text={card.term} lang={card.termLang} label={`Play question ${index + 1}`} />
            <AudioButton text={card.term} lang={card.termLang} slow label={`Play question ${index + 1} slowly`} />
          </div>
          {typed("Type what you hear")}
        </>
      )}
    </fieldset>
  );
}
