"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { CardDTO, DeckDTO, SentenceDTO } from "@/lib/data";
import { SENTENCE_MASTERED } from "@/lib/sentences";
import { getLanguage, langDir } from "@/lib/languages";
import { deckTopics, NEW_PROGRESS, QUESTION_LABELS, STAGE_NAMES, stageBuckets, topicSummary, type QuestionType, type StudyCard } from "@/lib/learn";
import { isDue } from "@/lib/srs";
import { AudioButton } from "./audio";
import { CardImage } from "./card-image";
import { formatDate } from "./dashboard";
import { useApp, useConfirm, useToast } from "./providers";
import { EmptyState } from "./ui";

export const MODES = [
  { mode: "learn", icon: "🧠", label: "Learn", desc: "Your daily session" },
  { mode: "flashcards", icon: "🃏", label: "Flashcards", desc: "Flip and sort" },
  { mode: "write", icon: "✍️", label: "Write", desc: "Type every term" },
  { mode: "listen", icon: "🎧", label: "Listen", desc: "Dictation" },
  { mode: "match", icon: "🎯", label: "Match", desc: "Beat the clock" },
  { mode: "test", icon: "📝", label: "Test", desc: "Generated exam" },
  { mode: "sentences", icon: "💬", label: "Sentences", desc: "Words in context" },
] as const;

const MODE_STAT_LABELS: Record<string, string> = {
  ...QUESTION_LABELS,
  flashcards: "Flashcards",
};

function formatDue(iso: string | null, stage: number) {
  if (stage === 0 || !iso) return "—";
  const d = new Date(iso);
  if (d.getTime() <= Date.now()) return "Now";
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString();
}

export function DeckOverview({
  deck,
  cards: initialCards,
  sentences = [],
}: {
  deck: DeckDTO;
  cards: CardDTO[];
  sentences?: SentenceDTO[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { gemini } = useApp();
  const [organizing, setOrganizing] = useState<string | null>(null);
  const [cards, setCards] = useState(initialCards);
  const [busy, setBusy] = useState(false);
  const termLang = getLanguage(deck.termLang);
  const defLang = getLanguage(deck.definitionLang);

  const buckets = useMemo(() => stageBuckets(cards), [cards]);
  const hasTopics = cards.some((c) => c.groupLabel);
  const topics = useMemo(
    () =>
      topicSummary(
        deckTopics(cards.map((c) => ({ id: c.id, group: c.groupLabel, progress: c.progress }) as unknown as StudyCard)),
      ),
    [cards],
  );
  const dueCount = useMemo(() => cards.filter((c) => c.progress.stage >= 1 && isDue(c.progress.dueAt)).length, [cards]);
  const accuracy = useMemo(() => {
    const agg: Record<string, { correct: number; wrong: number }> = {};
    for (const c of cards)
      for (const [k, v] of Object.entries(c.progress.modeStats ?? {})) {
        agg[k] ??= { correct: 0, wrong: 0 };
        agg[k].correct += v.correct;
        agg[k].wrong += v.wrong;
      }
    return Object.entries(agg)
      .filter(([k, v]) => v.correct + v.wrong > 0 && k in MODE_STAT_LABELS)
      .sort((a, b) => b[1].correct + b[1].wrong - (a[1].correct + a[1].wrong));
  }, [cards]);

  async function duplicate() {
    setBusy(true);
    try {
      const res = await api<{ deck: DeckDTO }>(`/api/decks/${deck.id}/duplicate`, { method: "POST" });
      toast.show("Deck duplicated", { kind: "success" });
      router.push(`/decks/${res.deck.id}`);
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Couldn't duplicate", { kind: "error" });
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: "Delete this deck?", message: `“${deck.title}” and all its cards and progress will be deleted. This can't be undone.`, confirmLabel: "Delete deck", danger: true }))) return;
    setBusy(true);
    try {
      await api(`/api/decks/${deck.id}`, { method: "DELETE" });
      toast.show("Deck deleted");
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Couldn't delete", { kind: "error" });
      setBusy(false);
    }
  }

  /** AI pass over every card: picture yes/no, image keyword and topic; then find missing pictures. */
  async function organize() {
    setOrganizing("Organising with AI…");
    try {
      const ids = cards.map((c) => c.id);
      for (let i = 0; i < ids.length; i += 60) {
        setOrganizing(`Organising with AI… ${Math.min(i + 60, ids.length)}/${ids.length}`);
        await api(`/api/decks/${deck.id}/organize`, { body: { cardIds: ids.slice(i, i + 60), force: true } });
      }
      const fresh = await api<{ cards: CardDTO[] }>(`/api/decks/${deck.id}`);
      const missing = fresh.cards.filter((c) => !c.displayImageUrl && !c.noImage);
      let done = 0;
      for (const c of missing) {
        setOrganizing(`Finding images… ${++done}/${missing.length}`);
        await api(`/api/cards/${c.id}/auto-image`, { method: "POST" }).catch(() => null);
      }
      const final = await api<{ cards: CardDTO[] }>(`/api/decks/${deck.id}`);
      setCards(final.cards);
      toast.show("Deck organised: topics set, pictures only where they help", { kind: "success" });
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Organising failed", { kind: "error" });
    } finally {
      setOrganizing(null);
    }
  }

  async function resetDeck() {
    if (!(await confirm({ title: "Reset progress for this deck?", message: "All cards go back to New. Your review history is kept.", confirmLabel: "Reset progress", danger: true }))) return;
    await api(`/api/decks/${deck.id}/reset-progress`, { method: "POST" });
    setCards((cs) => cs.map((c) => ({ ...c, progress: { ...NEW_PROGRESS } })));
    toast.show("Progress reset");
  }

  async function resetCard(id: string) {
    await api(`/api/cards/${id}/reset-progress`, { method: "POST" });
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, progress: { ...NEW_PROGRESS } } : c)));
    toast.show("Card progress reset");
  }

  const otherModes = MODES.filter((m) => m.mode !== "learn");
  const doneToday = cards.length - buckets.new;

  return (
    <div className="space-y-10 pt-2">
      <section>
        <Link href="/" className="text-sm font-medium text-muted hover:text-accent">
          All decks
        </Link>
        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="mr-auto min-w-0">
            <p className="text-sm text-muted">
              <span aria-hidden>{termLang.flag}</span> {termLang.name} <span aria-hidden>/</span>
              <span className="sr-only">to</span> <span aria-hidden>{defLang.flag}</span> {defLang.name}
            </p>
            <h1 className="headword mt-1 text-[2.4rem] leading-[1.1] sm:text-[3rem]" data-testid="deck-title">
              {deck.title}
            </h1>
            <p className="mt-2 text-muted">
              {cards.length} cards, studied {formatDate(deck.lastStudiedAt).toLowerCase()}
            </p>
            {deck.description && <p className="mt-2 max-w-2xl">{deck.description}</p>}
          </div>
          <div className="-ml-2 flex flex-wrap gap-0.5 sm:ml-0 sm:gap-2">
            <Link href={`/decks/${deck.id}/edit`} className="btn-secondary px-3 text-sm sm:px-4 sm:text-[0.95rem]">
              Edit
            </Link>
            {gemini && cards.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={organize}
                disabled={Boolean(organizing)}
                title="Group words by topic and keep pictures only for words where a picture helps"
                data-testid="organize-ai"
              >
                {organizing ?? "Organize with AI"}
              </button>
            )}
            <button type="button" className="btn-ghost px-2.5 text-sm sm:px-4 sm:text-[0.95rem]" onClick={duplicate} disabled={busy}>
              Duplicate
            </button>
            <a href={`/api/decks/${deck.id}/export.csv`} className="btn-ghost px-2.5 text-sm sm:px-4 sm:text-[0.95rem]" download>
              Export CSV
            </a>
            <button type="button" className="btn-ghost px-2.5 text-sm text-danger sm:px-4 sm:text-[0.95rem]" onClick={remove} disabled={busy}>
              Delete
            </button>
          </div>
        </div>
      </section>

      {cards.length === 0 ? (
        <EmptyState title="This deck has no cards yet">
          <Link href={`/decks/${deck.id}/edit`} className="btn-primary mt-4">
            Add cards
          </Link>
        </EmptyState>
      ) : (
        <>
          <section aria-label="Study modes" className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
            <h2 className="sr-only">Study modes</h2>
            <Link
              href={`/decks/${deck.id}/study/learn`}
              className="index-card ruled group relative flex flex-col px-6 pb-6 pt-3 sm:px-8"
              data-testid="mode-learn"
            >
              <span className="flex h-8 items-center text-sm text-muted">Your daily session</span>
              <span className="headword text-[2.2rem] leading-[64px] text-fg group-hover:text-accent">Learn</span>
              <span className="text-[0.95rem] leading-8 text-fg">
                {dueCount > 0 ? (
                  <>
                    <span className="highlight">{dueCount} due</span> plus new words from{" "}
                  </>
                ) : (
                  <>New words from </>
                )}
                {topics.find((t) => t.current)?.label ?? "your deck"}.
              </span>
              <span className="leading-8 text-muted">
                {doneToday} of {cards.length} words started, {buckets.mastered} mastered.
              </span>
              <span className="btn-primary mt-4 self-start px-6">Start learning</span>
            </Link>
            <ul className="divide-y divide-line border-y border-line self-start">
              {otherModes.map((m) => (
                <li key={m.mode}>
                  <Link
                    href={`/decks/${deck.id}/study/${m.mode}`}
                    className="group flex min-h-14 items-baseline justify-between gap-4 px-1 py-3"
                    data-testid={`mode-${m.mode}`}
                  >
                    <span className="font-display text-lg font-semibold group-hover:text-accent">{m.label}</span>
                    <span className="text-right text-sm text-muted">
                      {m.mode === "sentences" && sentences.length
                        ? `${sentences.filter((x) => x.unlocked).length}/${sentences.length} unlocked`
                        : m.desc}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="topics-h" data-testid="topics-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2">
              <h2 id="topics-h" className="text-xl font-semibold">
                {hasTopics ? "Topics" : "Sets"}
              </h2>
              <p className="text-sm text-muted">
                One {hasTopics ? "topic" : "set"} at a time; the next starts when 3 of every 4 words can be written.{" "}
                <Link href="/help#learned" className="font-medium text-accent hover:underline">
                  How it works
                </Link>
              </p>
            </div>
            <ol className="grid gap-x-8 sm:grid-cols-2">
              {topics.map((t, i) => (
                <li
                  key={t.key}
                  className={`border-b border-line py-3 pl-3 ${t.current ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"}`}
                  data-testid="topic-row"
                  data-current={t.current}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">
                      <span className="mr-1.5 text-muted tabular-nums">{i + 1}.</span>
                      {t.label}
                    </span>
                    <span className={`text-sm ${t.finished ? "text-success" : t.current ? "font-semibold text-accent" : "text-muted"}`}>
                      {t.mastered === t.total ? "Mastered" : t.finished ? "Done" : t.current ? "Learning now" : t.new === t.total ? "Up next" : "In progress"}
                    </span>
                  </div>
                  <div className="mt-2 flex h-[3px] overflow-hidden bg-rule" aria-hidden>
                    <div className="bg-success" style={{ width: `${(t.mastered / t.total) * 100}%` }} />
                    <div className="bg-accent" style={{ width: `${((t.written - t.mastered) / t.total) * 100}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    {t.mastered}/{t.total} mastered, {t.written - t.mastered} written, {t.new} new
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <SentencesPanel deckId={deck.id} sentences={sentences} cards={cards} />

          <section className="grid gap-4 md:grid-cols-[2fr_1fr]" aria-label="Progress">
            <div className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">
                Progress{" "}
                <Link href="/help#learned" className="ml-2 font-sans text-sm font-medium text-accent hover:underline">
                  When is a word learned?
                </Link>
              </h2>
                <span className="highlight text-sm" data-testid="deck-due">
                  {dueCount} due today
                </span>
              </div>
              <div className="mt-4 flex h-2 overflow-hidden rounded-[2px] bg-rule" aria-hidden>
                <div className="bg-success" style={{ width: `${(buckets.mastered / cards.length) * 100}%` }} />
                <div className="bg-accent" style={{ width: `${(buckets.learning / cards.length) * 100}%` }} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-muted">New</dt>
                  <dd className="font-display text-2xl font-semibold tabular-nums" data-testid="count-new">{buckets.new}</dd>
                </div>
                <div>
                  <dt className="text-accent">Learning</dt>
                  <dd className="font-display text-2xl font-semibold tabular-nums" data-testid="count-learning">{buckets.learning}</dd>
                </div>
                <div>
                  <dt className="text-success">Mastered</dt>
                  <dd className="font-display text-2xl font-semibold tabular-nums" data-testid="count-mastered">{buckets.mastered}</dd>
                </div>
              </dl>
              {deck.matchBestMs && (
                <p className="mt-3 text-sm text-muted">
                  Best Match time: <b className="text-fg">{(deck.matchBestMs / 1000).toFixed(1)} s</b>
                </p>
              )}
            </div>
            <div className="panel p-5">
              <h2 className="text-xl font-semibold">Accuracy by mode</h2>
              {accuracy.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No answers yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {accuracy.map(([mode, v]) => (
                    <li key={mode} className="flex justify-between gap-2">
                      <span>{MODE_STAT_LABELS[mode as QuestionType] ?? mode}</span>
                      <span className="tabular-nums text-muted">
                        {Math.round((v.correct / (v.correct + v.wrong)) * 100)}% ({v.correct}/{v.correct + v.wrong})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel overflow-hidden" aria-label="Cards">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-xl font-semibold">Words</h2>
              <button type="button" className="btn-ghost text-sm text-danger" onClick={resetDeck}>
                Reset deck progress
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-y border-line text-left text-sm text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium" scope="col">
                      <span className="sr-only">Image</span>
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">Term</th>
                    <th className="px-4 py-2 font-medium" scope="col">Definition</th>
                    {hasTopics && (
                      <th className="px-4 py-2 font-medium" scope="col">Topic</th>
                    )}
                    <th className="px-4 py-2 font-medium" scope="col">Stage</th>
                    <th className="px-4 py-2 font-medium" scope="col">Next due</th>
                    <th className="px-4 py-2 font-medium" scope="col">Right / wrong</th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => {
                    const totals = Object.values(c.progress.modeStats ?? {}).reduce(
                      (a, v) => ({ correct: a.correct + v.correct, wrong: a.wrong + v.wrong }),
                      { correct: 0, wrong: 0 },
                    );
                    return (
                      <tr key={c.id} className="border-t border-line" data-testid="card-table-row">
                        <td className="w-14 px-4 py-2">
                          {c.displayImageUrl || !c.noImage ? (
                            <CardImage src={c.displayImageUrl} alt={c.definition} term={c.term} className="h-10 w-10" />
                          ) : (
                            <span className="text-xs text-muted" title="No picture needed">
                              —
                            </span>
                          )}
                        </td>
                        <td className="headword px-4 py-2 text-base" dir={langDir(deck.termLang)} lang={deck.termLang}>
                          <span className="inline-flex items-center gap-1">
                            {c.term}
                            <AudioButton text={c.term} lang={deck.termLang} size="sm" />
                          </span>
                        </td>
                        <td className="px-4 py-2" dir={langDir(deck.definitionLang)}>
                          {c.definition}
                        </td>
                        {hasTopics && (
                          <td className="px-4 py-2 text-muted" data-testid="card-topic">
                            {c.groupLabel ?? "—"}
                          </td>
                        )}
                        <td className="px-4 py-2" data-testid="card-stage">
                          {STAGE_NAMES[c.progress.stage]}
                        </td>
                        <td className="px-4 py-2">{formatDue(c.progress.dueAt, c.progress.stage)}</td>
                        <td className="px-4 py-2 tabular-nums">
                          {totals.correct} / {totals.wrong}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {c.progress.stage > 0 && (
                            <button
                              type="button"
                              className="btn-ghost min-h-9 px-2 text-xs"
                              onClick={() => resetCard(c.id)}
                              aria-label={`Reset progress for ${c.term}`}
                            >
                              Reset
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SentencesPanel({ deckId, sentences, cards }: { deckId: string; sentences: SentenceDTO[]; cards: CardDTO[] }) {
  const termOf = new Map(cards.map((c) => [c.id, c]));
  const unlocked = sentences.filter((x) => x.unlocked);
  const mastered = sentences.filter((x) => x.progress.stage >= SENTENCE_MASTERED);
  const locked = sentences.filter((x) => !x.unlocked);
  return (
    <section className="panel p-5" aria-labelledby="sentences-h" data-testid="sentences-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sentences-h" className="text-xl font-semibold">
          Sentences
        </h2>
        {sentences.length > 0 && (
          <p className="text-sm text-muted" data-testid="sentences-summary">
            {unlocked.length} of {sentences.length} unlocked, {mastered.length} mastered
          </p>
        )}
      </div>
      {sentences.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Add example sentences in the editor (Bulk import, then Sentences). Each sentence unlocks once you’ve mastered the
          deck words in it. Then you practise it: fill in the blank, read it, put the words in order, and match questions
          with replies.{" "}
          <Link href={`/decks/${deckId}/edit`} className="font-semibold text-accent hover:underline">
            Add sentences
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            Unlocked sentences join your daily Learn session. A sentence unlocks when every deck word in it is mastered.
          </p>
          {locked.length > 0 && (
            <ul className="mt-3 divide-y divide-line border-t border-line text-sm" aria-label="Locked sentences">
              {locked.slice(0, 5).map((x) => {
                const missing = x.cardIds
                  .map((id) => termOf.get(id))
                  .filter((c): c is CardDTO => Boolean(c) && c!.progress.stage < 6)
                  .map((c) => c.term);
                return (
                  <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2" data-testid="locked-sentence">
                    <span className="font-display font-medium text-muted">{x.text}</span>
                    <span className="text-xs text-muted">
                      {missing.length ? `Locked, needs: ${missing.join(", ")}` : "Locked until your first mastered word"}
                    </span>
                  </li>
                );
              })}
              {locked.length > 5 && <li className="text-xs text-muted">…and {locked.length - 5} more</li>}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
