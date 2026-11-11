"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { playCelebration, playFeedback } from "@/lib/client/sounds";
import {
  articleTip,
  buildGrammarRound,
  cardArticle,
  checkPlural,
  fullForms,
  hasPlural,
  pluralArticle,
  pluralTip,
  type GrammarQuestion,
} from "@/lib/grammar";
import { genderArticles, langDir } from "@/lib/languages";
import type { StudyCard } from "@/lib/learn";
import { AudioButton } from "../audio";
import { CheckIcon, CrossIcon } from "../icons";
import { useApp } from "../providers";
import { Confetti, EmptyState, ProgressBar, SpecialCharsBar } from "../ui";
import { postReview, SessionHeader, useEscToExit } from "./session";

const ROUND_SIZE = 10;

type Result = { q: GrammarQuestion; correct: boolean; given: string };

/** Nouns whose plural was already picked correctly are asked to be typed next time. */
function knownPlurals(cards: StudyCard[]) {
  return new Set(cards.filter((c) => (c.progress.modeStats.plural?.correct ?? 0) > 0).map((c) => c.id));
}

/**
 * Articles & plurals: a separate game that only drills the article (der/die/das…) and the plural of each noun —
 * not the meaning. Missed questions come back once at the end of the round.
 */
export function GrammarGame({
  deckId,
  cards: initialCards,
  title,
  exitHref,
}: {
  deckId: string;
  cards: StudyCard[];
  title: string;
  exitHref: string;
}) {
  const { settings } = useApp();
  const lang = initialCards[0]?.termLang ?? "";
  const [cards, setCards] = useState(initialCards);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const nouns = useMemo(
    () => cards.filter((c) => cardArticle({ term: c.term, article: c.article ?? null }, lang) || hasPlural(c.plural)),
    [cards, lang],
  );
  // Only nouns already met in Learn: the game practises forms you've seen, it doesn't make you guess.
  const playable = useMemo(() => nouns.filter((c) => c.progress.stage >= 1), [nouns]);
  const newRound = () =>
    buildGrammarRound(
      playable.map((c) => ({ id: c.id, term: c.term, definition: c.definition, article: c.article ?? null, plural: c.plural ?? null })),
      lang,
      { size: ROUND_SIZE, known: knownPlurals(cards) },
    );
  const [queue, setQueue] = useState<GrammarQuestion[]>(() => newRound());
  const [pos, setPos] = useState(0);
  const [answer, setAnswer] = useState<{ correct: boolean; given: string } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const retried = useRef(new Set<string>());
  const shownAt = useRef(0);
  const done = queue.length > 0 && pos >= queue.length;

  useEscToExit(exitHref, !done && queue.length > 0);

  const q = queue[pos];
  useEffect(() => {
    shownAt.current = performance.now();
  }, [q?.key]);

  function onAnswer(given: string) {
    if (!q || answer) return;
    const correct = q.kind === "plural_write" ? checkPlural(given, q.answer, lang) : given === q.answer;
    setAnswer({ correct, given });
    setResults((r) => [...r, { q, correct, given }]);
    if (settings.soundEffects) playFeedback(correct);
    // A missed question comes back once, at the end of the round.
    if (!correct && !retried.current.has(q.key)) {
      retried.current.add(q.key);
      setQueue((qs) => [...qs, { ...q, key: `${q.key}:again` }]);
    }
    void postReview({
      cardId: q.cardId,
      mode: "grammar",
      questionType: q.kind === "article" ? "article" : "plural",
      correct,
      answerGiven: given,
      responseMs: Math.round(performance.now() - shownAt.current),
    }).then((res) => {
      if (res?.progress) setCards((cs) => cs.map((c) => (c.id === q.cardId ? { ...c, progress: res.progress } : c)));
    });
  }

  function next() {
    setAnswer(null);
    setPos((p) => p + 1);
  }

  function playAgain() {
    retried.current = new Set();
    setQueue(newRound());
    setPos(0);
    setResults([]);
    setAnswer(null);
  }

  if (queue.length === 0 && nouns.length > 0) return <NotSeenYet deckId={deckId} count={nouns.length} title={title} exitHref={exitHref} />;
  if (queue.length === 0) return <NoNouns deckId={deckId} lang={lang} title={title} exitHref={exitHref} />;
  if (done) return <Score results={results} byId={byId} lang={lang} exitHref={exitHref} onPlayAgain={playAgain} />;

  const card = byId.get(q.cardId)!;
  return (
    <div className="mx-auto max-w-2xl">
      <SessionHeader title={title} exitHref={exitHref}>
        <span className="chip" data-testid="grammar-kind">
          {q.kind === "article" ? "Article" : "Plural"}
        </span>
      </SessionHeader>
      <ProgressBar value={pos + (answer ? 1 : 0)} max={queue.length} label="Round progress" />
      <div className="sr-only" aria-live="assertive">
        {answer ? (answer.correct ? "Correct" : `Not quite. ${q.answer}`) : ""}
      </div>
      <div className="index-card mt-5 px-4 pb-6 pt-4 sm:px-8" data-testid="grammar-question" data-kind={q.kind} data-card-id={q.cardId} key={q.key}>
        <GrammarPrompt q={q} card={card} lang={lang} />
        {q.kind === "plural_write" ? (
          <PluralInput key={q.key} lang={lang} answered={answer} onAnswer={onAnswer} />
        ) : (
          <Choices q={q} lang={lang} answered={answer} onAnswer={onAnswer} />
        )}
        {answer && <GrammarFeedback q={q} card={card} lang={lang} answer={answer} onContinue={next} />}
      </div>
    </div>
  );
}

function GrammarPrompt({ q, card, lang }: { q: GrammarQuestion; card: StudyCard; lang: string }) {
  const article = q.kind === "article" ? null : q.article;
  const sg = article ? (article.endsWith("'") ? `${article}${q.noun}` : `${article} ${q.noun}`) : q.noun;
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <p className="text-sm text-muted">{q.kind === "article" ? "Which article?" : "What’s the plural?"}</p>
      <p className="headword flex items-center gap-2 text-[2.4rem] leading-tight sm:text-[2.8rem]" dir={langDir(lang)} lang={lang} data-testid="grammar-noun">
        {q.kind === "article" ? (
          <>
            <span className="text-muted" aria-hidden>
              ___
            </span>{" "}
            {q.noun}
          </>
        ) : (
          sg
        )}
        <AudioButton text={q.noun} lang={lang} size="sm" label="Play the word" />
      </p>
      <p className="text-muted" dir={langDir(card.definitionLang)}>
        {card.definition}
      </p>
    </div>
  );
}

function Choices({
  q,
  lang,
  answered,
  onAnswer,
}: {
  q: Extract<GrammarQuestion, { options: string[] }>;
  lang: string;
  answered: { correct: boolean; given: string } | null;
  onAnswer: (given: string) => void;
}) {
  useEffect(() => {
    if (answered) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length && !e.metaKey && !e.ctrlKey) onAnswer(q.options[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answered, q.options, onAnswer]);

  const article = q.kind === "article";
  const pa = q.kind === "plural_mc" ? pluralArticle(q.article, lang) : null;
  return (
    <ul className={`mx-auto mt-2 grid max-w-xl gap-3 ${article ? (q.options.length <= 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4") : "sm:grid-cols-2"}`}>
      {q.options.map((opt, i) => {
        const isAnswer = opt === q.answer;
        const state = !answered ? "idle" : isAnswer ? "correct" : opt === answered.given ? "wrong" : "idle";
        return (
          <li key={opt}>
            <button
              type="button"
              onClick={() => onAnswer(opt)}
              disabled={Boolean(answered)}
              lang={lang}
              data-testid="grammar-option"
              data-correct={answered ? String(isAnswer) : undefined}
              className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 font-display transition-colors ${
                article ? "min-h-20 text-[1.7rem] font-semibold" : "min-h-14 text-xl"
              } ${
                state === "correct"
                  ? "border-success bg-success-soft shadow-[inset_0_-3px_0_var(--success)]"
                  : state === "wrong"
                    ? "animate-shake border-danger bg-danger-soft shadow-[inset_0_-3px_0_var(--danger)]"
                    : "border-line bg-surface hover:border-accent hover:shadow-[inset_0_-3px_0_var(--accent)] disabled:opacity-60"
              }`}
            >
              <span className="sr-only">{i + 1}. </span>
              {pa && <span className="text-muted">{pa}</span>}
              {opt}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PluralInput({
  lang,
  answered,
  onAnswer,
}: {
  lang: string;
  answered: { correct: boolean; given: string } | null;
  onAnswer: (given: string) => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className="mx-auto mt-2 max-w-xl space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (answered) return;
        if (!value.trim()) return ref.current?.focus();
        onAnswer(value);
      }}
    >
      <label htmlFor="plural-answer" className="label">
        Type the plural <span className="font-normal text-muted">(umlauts and accents count)</span>
      </label>
      <input
        id="plural-answer"
        ref={ref}
        className={`input text-xl ${answered ? (answered.correct ? "border-success" : "border-danger") : ""}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        readOnly={Boolean(answered)}
        dir={langDir(lang)}
        lang={lang}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        data-testid="plural-input"
      />
      {!answered && <SpecialCharsBar lang={lang} inputRef={ref} onInsert={setValue} />}
      {!answered && (
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1" data-testid="plural-submit">
            Check
          </button>
          <button type="button" className="btn-secondary" onClick={() => onAnswer("")}>
            Don&apos;t know
          </button>
        </div>
      )}
    </form>
  );
}

function GrammarFeedback({
  q,
  card,
  lang,
  answer,
  onContinue,
}: {
  q: GrammarQuestion;
  card: StudyCard;
  lang: string;
  answer: { correct: boolean; given: string };
  onContinue: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus({ preventScroll: true });
  }, []);
  const article = cardArticle({ term: card.term, article: card.article ?? null }, lang);
  const tip = answer.correct ? null : q.kind === "article" ? articleTip(q.noun, lang) : pluralTip(q.noun, lang, article);
  return (
    <div
      className={`mt-5 border-l-4 px-4 py-3 ${answer.correct ? "border-success bg-success-soft" : "border-danger bg-danger-soft"}`}
      data-testid="grammar-feedback"
      data-correct={String(answer.correct)}
    >
      <p className={`flex items-center gap-2 font-semibold ${answer.correct ? "text-success" : "text-danger"}`}>
        {answer.correct ? <CheckIcon size={18} /> : <CrossIcon size={18} />}
        {answer.correct ? "Correct" : "Not quite"}
      </p>
      <p className="mt-1 font-display text-xl" lang={lang} data-testid="grammar-full">
        {fullForms(q.noun, article, card.plural ?? null, lang)}
      </p>
      {!answer.correct && answer.given && q.kind === "plural_write" && (
        <p className="mt-1 text-sm text-muted">
          You wrote <s lang={lang}>{answer.given}</s>
        </p>
      )}
      {tip && (
        <p className="mt-2 text-sm" data-testid="grammar-tip">
          <b>Tip:</b> {tip}
        </p>
      )}
      <button ref={btn} type="button" className="btn-primary mt-3 w-full" onClick={onContinue} data-testid="grammar-continue">
        Continue
      </button>
    </div>
  );
}

function Score({
  results,
  byId,
  lang,
  exitHref,
  onPlayAgain,
}: {
  results: Result[];
  byId: Map<string, StudyCard>;
  lang: string;
  exitHref: string;
  onPlayAgain: () => void;
}) {
  const { settings } = useApp();
  // Score the first try at each question; the end-of-round retries are practice.
  const first = results.filter((r) => !r.q.key.endsWith(":again"));
  const right = first.filter((r) => r.correct).length;
  const missedIds = Array.from(new Set(first.filter((r) => !r.correct).map((r) => r.q.cardId)));
  const perfect = right === first.length;
  useEffect(() => {
    if (settings.soundEffects) playCelebration();
  }, [settings.soundEffects]);
  return (
    <div className="mx-auto max-w-xl text-center">
      {perfect && <Confetti />}
      <div className="index-card animate-pop mt-6 px-6 pb-8 pt-3 sm:px-10" data-testid="grammar-score">
        <h1 className="mt-4 text-[2rem] font-semibold">{perfect ? "Perfect round!" : "Round complete"}</h1>
        <p className="mt-2 text-lg" data-testid="grammar-score-text">
          <span className="font-display text-3xl font-semibold tabular-nums">
            {right}/{first.length}
          </span>{" "}
          <span className="text-muted">right first time</span>
        </p>
        {missedIds.length > 0 && (
          <div className="mt-5 text-left">
            <h2 className="font-semibold text-danger">Worth another look</h2>
            <ul className="mt-1 space-y-1" lang={lang}>
              {missedIds.map((id) => {
                const c = byId.get(id)!;
                const art = cardArticle({ term: c.term, article: c.article ?? null }, lang);
                const noun = results.find((r) => r.q.cardId === id)!.q.noun;
                return (
                  <li key={id} className="font-display text-lg">
                    {fullForms(noun, art, c.plural ?? null, lang)}{" "}
                    <span className="font-sans text-sm text-muted">— {c.definition}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" className="btn-primary" onClick={onPlayAgain} autoFocus data-testid="grammar-again">
            Play again
          </button>
          <Link href={exitHref} className="btn-secondary">
            Back to deck
          </Link>
        </div>
      </div>
    </div>
  );
}

/** No noun in the deck has an article or plural yet: offer to look them up. */
function NoNouns({ deckId, lang, title, exitHref }: { deckId: string; lang: string; title: string; exitHref: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const supported = genderArticles(lang).length > 0;

  async function lookUp() {
    setError("");
    try {
      let total = 0;
      for (let i = 0; i < 30; i++) {
        setBusy(`Looking up articles and plurals… ${total} checked`);
        const res = await api<{ cards: unknown[]; remaining: number }>(`/api/decks/${deckId}/grammar`, { body: {} });
        total += res.cards.length;
        if (res.remaining === 0 || res.cards.length === 0) break;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't look them up right now");
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <SessionHeader title={title} exitHref={exitHref} />
      <EmptyState title={supported ? "No articles or plurals yet" : "Not for this language"}>
        {supported ? (
          <>
            <p className="mx-auto max-w-md">
              This game drills the article and plural of each noun. Write the article in front of the word (“das Buch”), add
              plurals in the editor, or let the app look them up.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button type="button" className="btn-primary" onClick={lookUp} disabled={Boolean(busy)} data-testid="grammar-lookup">
                {busy ?? "Look them up"}
              </button>
              <Link href={`/decks/${deckId}/edit`} className="btn-secondary">
                Open the editor
              </Link>
            </div>
            {error && (
              <p className="field-error mt-3" role="alert">
                {error}
              </p>
            )}
          </>
        ) : (
          <p className="mx-auto max-w-md">
            Articles &amp; plurals is for languages whose nouns have a gender: German, French, Spanish, Italian and Portuguese.
          </p>
        )}
      </EmptyState>
    </div>
  );
}

/** The deck has nouns, but none has been met in Learn yet. */
function NotSeenYet({ deckId, count, title, exitHref }: { deckId: string; count: number; title: string; exitHref: string }) {
  return (
    <div className="mx-auto max-w-2xl">
      <SessionHeader title={title} exitHref={exitHref} />
      <EmptyState title="Meet the words in Learn first">
        <p className="mx-auto max-w-md" data-testid="grammar-not-seen">
          This deck has {count} nouns with an article or plural. Learn shows each one with its article and plural; once
          you’ve met a noun there, it joins this game.
        </p>
        <div className="mt-5 flex justify-center">
          <Link href={`/decks/${deckId}/study/learn`} className="btn-primary">
            Go to Learn
          </Link>
        </div>
      </EmptyState>
    </div>
  );
}
