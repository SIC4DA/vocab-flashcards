"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, tzOffset } from "@/lib/client/api";
import type { DeckSummary } from "@/lib/data";
import { getLanguage } from "@/lib/languages";
import { EmptyState } from "./ui";

type Due = { total: number; perDeck: Record<string, number>; streak: number };

export function formatDate(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

export function Dashboard({ initialDecks }: { initialDecks: DeckSummary[] }) {
  const [decks] = useState(initialDecks);
  const [due, setDue] = useState<Due | null>(null);

  useEffect(() => {
    api<Due>(`/api/study/due?tz=${tzOffset()}`)
      .then(setDue)
      .catch(() => setDue({ total: 0, perDeck: {}, streak: 0 }));
  }, []);

  const totalDue = due?.total ?? decks.reduce((s, d) => s + d.dueCount, 0);

  return (
    <div className="space-y-6">
      <section className="panel flex flex-wrap items-center gap-4 p-5" aria-label="Today">
        <div className="flex-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Due today</p>
          <p className="text-3xl font-black" data-testid="due-total">
            {totalDue} <span className="text-base font-semibold text-muted">cards</span>
          </p>
        </div>
        <div className="text-center" title="Consecutive days with at least one review">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Streak</p>
          <p className="text-3xl font-black" data-testid="streak">
            <span aria-hidden>🔥</span> {due?.streak ?? "–"}
            <span className="sr-only"> days</span>
          </p>
        </div>
        {totalDue > 0 ? (
          <Link href="/review" className="btn-primary w-full sm:w-auto">
            Review all due
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none w-full opacity-70 sm:w-auto">All caught up ✨</span>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Your decks</h1>
        <Link href="/decks/new" className="btn-primary">
          <span aria-hidden>＋</span> Create deck
        </Link>
      </div>

      {decks.length === 0 ? (
        <EmptyState title="Create your first deck">
          <ol className="mx-auto mt-2 max-w-sm list-decimal space-y-1 pl-5 text-left">
            <li>Pick the language you&apos;re learning and your own language.</li>
            <li>Add words — type them, paste a list, or let auto-fill suggest meanings.</li>
            <li>Images and pronunciation are added automatically.</li>
            <li>Press <b>Learn</b> and practise a few minutes every day.</li>
          </ol>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/decks/new" className="btn-primary">
              Create your first deck
            </Link>
            <Link href="/help" className="btn-secondary">
              How it works
            </Link>
          </div>
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((d) => {
            const term = getLanguage(d.termLang);
            const def = getLanguage(d.definitionLang);
            const dueCount = due?.perDeck[d.id] ?? d.dueCount;
            const mastery = d.cardCount ? Math.round((d.masteredCount / d.cardCount) * 100) : 0;
            return (
              <li key={d.id}>
                <Link
                  href={`/decks/${d.id}`}
                  className="panel block h-full p-5 transition-transform hover:-translate-y-0.5"
                  data-testid="deck-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 text-lg font-bold">{d.title}</h2>
                    {dueCount > 0 && (
                      <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning">
                        {dueCount} due
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    <span aria-hidden>{term.flag}</span> {term.name} → <span aria-hidden>{def.flag}</span> {def.name}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span className="chip">{d.cardCount} cards</span>
                    <span className="chip">{mastery}% mastered</span>
                    <span className="chip">Studied: {formatDate(d.lastStudiedAt)}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="h-full bg-success" style={{ width: `${mastery}%` }} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
