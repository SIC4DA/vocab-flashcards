"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { CardDTO, DeckDTO } from "@/lib/data";
import { cardArticle, hasPlural, splitArticle } from "@/lib/grammar";
import { genderArticles, getLanguage, langDir } from "@/lib/languages";
import { deckTopics, NEW_PROGRESS, QUESTION_LABELS, STAGE_NAMES, stageBuckets, topicSummary, type QuestionType, type StudyCard } from "@/lib/learn";
import { isDue } from "@/lib/srs";
import { AudioButton } from "./audio";
import { CardImage } from "./card-image";
import { formatDate } from "./dashboard";
import { MoreIcon } from "./icons";
import { useConfirm, useToast } from "./providers";
import { EmptyState } from "./ui";

export const MODES = [
  { mode: "learn", icon: "🧠", label: "Learn", desc: "Your daily session" },
  { mode: "flashcards", icon: "🃏", label: "Flashcards", desc: "Flip and sort" },
  { mode: "write", icon: "✍️", label: "Write", desc: "Type every term" },
  { mode: "listen", icon: "🎧", label: "Listen", desc: "Dictation" },
  { mode: "match", icon: "🎯", label: "Match", desc: "Beat the clock" },
  { mode: "test", icon: "📝", label: "Test", desc: "Generated exam" },
  { mode: "grammar", icon: "", label: "Articles & plurals", desc: "Gender and plural of each noun" },
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

export function DeckOverview({ deck, cards: initialCards }: { deck: DeckDTO; cards: CardDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [cards, setCards] = useState(initialCards);
  const [busy, setBusy] = useState(false);
  const termLang = getLanguage(deck.termLang);
  const defLang = getLanguage(deck.definitionLang);

  const buckets = useMemo(() => stageBuckets(cards), [cards]);
  const genders = genderArticles(deck.termLang);
  // Nouns ready for Articles & plurals: met in Learn, with an article or plural.
  const grammarCount = cards.filter((c) => c.progress.stage >= 1 && (cardArticle(c, deck.termLang) || hasPlural(c.plural))).length;
  const topics = useMemo(
    () =>
      topicSummary(
        deckTopics(cards.map((c) => ({ id: c.id, progress: c.progress }) as unknown as StudyCard)),
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

  async function resetDeck() {
    if (!(await confirm({ title: "Reset progress?", message: "Every word in this deck goes back to New. Your cards are kept.", confirmLabel: "Reset progress", danger: true }))) return;
    try {
      await api(`/api/decks/${deck.id}/reset-progress`, { method: "POST" });
      setCards((cs) => cs.map((c) => ({ ...c, progress: { ...NEW_PROGRESS } })));
      toast.show("Deck progress reset");
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Couldn't reset progress", { kind: "error" });
    }
  }

  async function resetCard(id: string) {
    try {
      await api(`/api/cards/${id}/reset-progress`, { method: "POST" });
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, progress: { ...NEW_PROGRESS } } : c)));
      toast.show("Progress reset");
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Couldn't reset progress", { kind: "error" });
    }
  }

  const otherModes = MODES.filter((m) => m.mode !== "learn" && (m.mode !== "grammar" || genders.length > 0));
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
          <div className="flex items-center gap-2">
            <Link href={`/decks/${deck.id}/edit`} className="btn-secondary px-4" data-testid="edit-deck">
              Edit
            </Link>
            <MoreMenu
              items={[
                { label: "Duplicate", onSelect: duplicate, disabled: busy },
                { label: "Export CSV", href: `/api/decks/${deck.id}/export.csv` },
                { label: "Reset progress", onSelect: resetDeck, disabled: cards.length === 0 },
                { label: "Delete deck", onSelect: remove, disabled: busy, danger: true },
              ]}
            />
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
                      {m.mode === "grammar"
                        ? `${genders.join(", ")} and plurals${grammarCount > 0 ? ` · ${grammarCount} nouns ready` : ""}`
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
                Sets
              </h2>
              <p className="text-sm text-muted">
                One set of 8 words at a time; the next starts when 3 of every 4 words can be written.{" "}
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
            <div className="px-5 py-4">
              <h2 className="text-xl font-semibold">Words</h2>
            </div>
            {/* relative: keeps the screen-reader-only labels inside the scroll box (they are absolutely positioned) */}
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-y border-line text-left text-sm text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium" scope="col">
                      <span className="sr-only">Image</span>
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">Term</th>
                    <th className="px-4 py-2 font-medium" scope="col">Definition</th>
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
                            {c.article && !splitArticle(c.term, deck.termLang).article && (
                              <span className="text-muted">{c.article}</span>
                            )}
                            {c.term}
                            <AudioButton text={c.term} lang={deck.termLang} size="sm" />
                          </span>
                          {hasPlural(c.plural) && (
                            <span className="block font-sans text-xs text-muted" data-testid="card-plural">
                              pl. {c.plural}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2" dir={langDir(deck.definitionLang)}>
                          {c.definition}
                        </td>
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

type MenuItem = { label: string; onSelect?: () => void; href?: string; disabled?: boolean; danger?: boolean };

/** "⋯" menu for the less common deck actions (keeps the deck page about studying). */
function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);

  const itemClass = (danger?: boolean) =>
    `block w-full px-4 py-2.5 text-left text-[0.95rem] hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-50 ${danger ? "text-danger" : ""}`;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More deck actions"
        onClick={() => setOpen((o) => !o)}
        data-testid="deck-menu"
      >
        <MoreIcon />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-lift)]"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
            const i = els.indexOf(document.activeElement as HTMLElement);
            els[(i + (e.key === "ArrowDown" ? 1 : els.length - 1)) % els.length]?.focus();
          }}
        >
          {items.map((it) =>
            it.href ? (
              <a key={it.label} role="menuitem" href={it.href} download className={itemClass(it.danger)} onClick={() => setOpen(false)}>
                {it.label}
              </a>
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={itemClass(it.danger)}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect?.();
                }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
