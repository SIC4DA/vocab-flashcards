"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { CardDTO, DeckDTO } from "@/lib/data";
import { getLanguage, langDir } from "@/lib/languages";
import { NEW_PROGRESS, QUESTION_LABELS, STAGE_NAMES, stageBuckets, type QuestionType } from "@/lib/learn";
import { isDue } from "@/lib/srs";
import { AudioButton } from "./audio";
import { CardImage } from "./card-image";
import { formatDate } from "./dashboard";
import { useApp, useConfirm, useToast } from "./providers";
import { EmptyState } from "./ui";

export const MODES = [
  { mode: "learn", icon: "🧠", label: "Learn", desc: "Adaptive: recognise → write → speak" },
  { mode: "flashcards", icon: "🃏", label: "Flashcards", desc: "Flip and sort" },
  { mode: "write", icon: "✍️", label: "Write", desc: "Type every term" },
  { mode: "listen", icon: "🎧", label: "Listen", desc: "Dictation" },
  { mode: "speak", icon: "🎤", label: "Speak", desc: "Say the word" },
  { mode: "match", icon: "🎯", label: "Match", desc: "Beat the clock" },
  { mode: "test", icon: "📝", label: "Test", desc: "Generated exam" },
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
  const { speakAvailable, speechSupported, speechFallback, settings, gemini } = useApp();
  const [organizing, setOrganizing] = useState<string | null>(null);
  const [cards, setCards] = useState(initialCards);
  const [busy, setBusy] = useState(false);
  const termLang = getLanguage(deck.termLang);
  const defLang = getLanguage(deck.definitionLang);

  const buckets = useMemo(() => stageBuckets(cards), [cards]);
  const hasTopics = cards.some((c) => c.groupLabel);
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
      .filter(([, v]) => v.correct + v.wrong > 0)
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

  const speakDisabledReason =
    speechSupported === false && !speechFallback
      ? "Speech recognition isn't supported in this browser (try Chrome, Edge or Safari)."
      : !settings.enableSpeaking
        ? "Speaking questions are turned off in Settings."
        : null;

  return (
    <div className="space-y-6">
      <section>
        <Link href="/" className="text-sm font-semibold text-accent hover:underline">
          ← All decks
        </Link>
        <div className="mt-2 flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <h1 className="text-3xl font-black tracking-tight" data-testid="deck-title">
              {deck.title}
            </h1>
            <p className="mt-1 text-muted">
              <span aria-hidden>{termLang.flag}</span> {termLang.name} → <span aria-hidden>{defLang.flag}</span>{" "}
              {defLang.name} · {cards.length} cards · studied {formatDate(deck.lastStudiedAt).toLowerCase()}
            </p>
            {deck.description && <p className="mt-2 max-w-2xl">{deck.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/decks/${deck.id}/edit`} className="btn-primary">
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
                {organizing ?? "✨ Organize with AI"}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={duplicate} disabled={busy}>
              Duplicate
            </button>
            <a href={`/api/decks/${deck.id}/export.csv`} className="btn-secondary" download>
              Export CSV
            </a>
            <button type="button" className="btn-secondary text-danger" onClick={remove} disabled={busy}>
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
          <section aria-label="Study modes">
            <h2 className="sr-only">Study modes</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {MODES.map((m) => {
                const disabled = m.mode === "speak" && !speakAvailable;
                const reason = m.mode === "speak" ? speakDisabledReason : null;
                const inner = (
                  <>
                    <span aria-hidden className="text-2xl">
                      {m.icon}
                    </span>
                    <span className="font-bold">{m.label}</span>
                    <span className="text-xs text-muted">{disabled && reason ? "Unavailable" : m.desc}</span>
                  </>
                );
                const cls =
                  "panel flex min-h-28 flex-col items-center justify-center gap-1 p-3 text-center transition-transform";
                return (
                  <li key={m.mode}>
                    {disabled ? (
                      <span className={`${cls} cursor-not-allowed opacity-60`} title={reason ?? undefined} aria-disabled="true">
                        {inner}
                        <span className="sr-only">{reason}</span>
                      </span>
                    ) : (
                      <Link
                        href={`/decks/${deck.id}/study/${m.mode}`}
                        className={`${cls} hover:-translate-y-0.5 hover:border-accent`}
                        data-testid={`mode-${m.mode}`}
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid gap-4 md:grid-cols-[2fr_1fr]" aria-label="Progress">
            <div className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">
                Progress{" "}
                <Link href="/help#learned" className="ml-1 text-xs font-semibold text-accent hover:underline">
                  When is a word learned?
                </Link>
              </h2>
                <span className="chip" data-testid="deck-due">
                  {dueCount} due today
                </span>
              </div>
              <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="bg-muted/40" style={{ width: `${(buckets.new / cards.length) * 100}%` }} />
                <div className="bg-warning" style={{ width: `${(buckets.learning / cards.length) * 100}%` }} />
                <div className="bg-success" style={{ width: `${(buckets.mastered / cards.length) * 100}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <dt className="text-muted">New</dt>
                  <dd className="text-xl font-bold" data-testid="count-new">{buckets.new}</dd>
                </div>
                <div>
                  <dt className="text-warning">Learning</dt>
                  <dd className="text-xl font-bold" data-testid="count-learning">{buckets.learning}</dd>
                </div>
                <div>
                  <dt className="text-success">Mastered</dt>
                  <dd className="text-xl font-bold" data-testid="count-mastered">{buckets.mastered}</dd>
                </div>
              </dl>
              {deck.matchBestMs && (
                <p className="mt-3 text-sm text-muted">
                  Best Match time: <b className="text-fg">{(deck.matchBestMs / 1000).toFixed(1)} s</b>
                </p>
              )}
            </div>
            <div className="panel p-5">
              <h2 className="font-bold">Accuracy by mode</h2>
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
            <div className="flex items-center justify-between p-4">
              <h2 className="font-bold">Cards</h2>
              <button type="button" className="btn-ghost text-sm text-danger" onClick={resetDeck}>
                Reset deck progress
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2" scope="col">
                      <span className="sr-only">Image</span>
                    </th>
                    <th className="px-4 py-2" scope="col">Term</th>
                    <th className="px-4 py-2" scope="col">Definition</th>
                    {hasTopics && (
                      <th className="px-4 py-2" scope="col">Topic</th>
                    )}
                    <th className="px-4 py-2" scope="col">Stage</th>
                    <th className="px-4 py-2" scope="col">Next due</th>
                    <th className="px-4 py-2" scope="col">✓ / ✗</th>
                    <th className="px-4 py-2" scope="col">
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
                        <td className="px-4 py-2 font-semibold" dir={langDir(deck.termLang)} lang={deck.termLang}>
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
