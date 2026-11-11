"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, tzOffset } from "@/lib/client/api";
import type { DeckSummary } from "@/lib/data";
import { getLanguage } from "@/lib/languages";
import { WeekStrip, type Week } from "./streak";
import { EmptyState } from "./ui";

type Due = {
  total: number;
  perDeck: Record<string, number>;
  streak: number;
  week: Week;
  daily: { total: number; answered: number; completed: boolean; known: number };
};

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
      .catch(() => setDue({ total: 0, perDeck: {}, streak: 0, week: [], daily: { total: 0, answered: 0, completed: false, known: 0 } }));
  }, []);

  const totalDue = due?.total ?? decks.reduce((s, d) => s + d.dueCount, 0);

  const decksDue = decks.filter((d) => (due?.perDeck[d.id] ?? d.dueCount) > 0).length;

  return (
    <div className="space-y-10 pt-4">
      <section aria-label="Today" className="flex flex-wrap items-end gap-x-10 gap-y-5 border-b border-line pb-8">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <h1 className="text-[2rem] leading-tight font-semibold sm:text-[2.6rem]">Today</h1>
          <p className="mt-2 max-w-xl text-lg text-muted">
            {totalDue > 0 ? (
              <>
                <span className="highlight text-lg" data-testid="due-total">
                  {totalDue} cards
                </span>{" "}
                {decksDue > 1 ? `due across ${decksDue} decks` : "due"} — they come up in Learn.
              </>
            ) : (
              <>
                <span className="sr-only" data-testid="due-total">
                  {totalDue} cards
                </span>
                Nothing is due. New words are waiting in your decks.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2" title="Days in a row you finished the daily review">
          <p className="text-sm text-muted">
            Streak{" "}
            <span className="font-display text-2xl font-semibold text-fg tabular-nums" data-testid="streak">
              {due?.streak ?? "–"} <span className="font-sans text-sm font-medium text-muted">days</span>
            </span>
          </p>
          {due && due.week.length > 0 && <WeekStrip week={due.week} />}
        </div>
        {due && <DailyCard daily={due.daily} />}
      </section>

      <section aria-labelledby="decks-h" className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="decks-h" className="text-2xl font-semibold">
            Your decks
          </h2>
          <Link href="/decks/new" className="btn-primary">
            Create deck
          </Link>
        </div>

        {decks.length === 0 ? (
          <EmptyState title="Create your first deck">
            <ol className="mx-auto mt-2 max-w-sm list-decimal space-y-1 pl-5 text-left">
              <li>Pick the language you&apos;re learning and your own language.</li>
              <li>Add words — type them, paste a list, or let auto-fill suggest meanings.</li>
              <li>Images and pronunciation are added automatically.</li>
              <li>
                Press <b>Learn</b> and practise a few minutes every day.
              </li>
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
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((d) => {
              const term = getLanguage(d.termLang);
              const def = getLanguage(d.definitionLang);
              const dueCount = due?.perDeck[d.id] ?? d.dueCount;
              const mastery = d.cardCount ? Math.round((d.masteredCount / d.cardCount) * 100) : 0;
              return (
                <li key={d.id}>
                  <Link
                    href={`/decks/${d.id}`}
                    className="index-card ruled group block h-full px-5 pb-4 pt-3 transition-shadow hover:shadow-[0_1px_1px_rgb(26_33_51/0.06),0_18px_36px_-14px_rgb(26_33_51/0.4)]"
                    data-testid="deck-card"
                  >
                    <p className="flex h-8 items-center justify-between gap-2 text-xs text-muted">
                      <span className="truncate">
                        <span aria-hidden>{term.flag}</span> {term.name} <span aria-hidden>/</span>
                        <span className="sr-only">to</span> <span aria-hidden>{def.flag}</span> {def.name}
                      </span>
                      {dueCount > 0 && <span className="highlight shrink-0 text-xs">{dueCount} due</span>}
                    </p>
                    <h3 className="headword line-clamp-2 text-[1.45rem] leading-8 group-hover:text-accent">{d.title}</h3>
                    <dl className="grid grid-cols-3 text-sm leading-8">
                      <div>
                        <dt className="sr-only">Cards</dt>
                        <dd>{d.cardCount} cards</dd>
                      </div>
                      <div>
                        <dt className="sr-only">Mastered</dt>
                        <dd>{mastery}% mastered</dd>
                      </div>
                      <div className="text-right text-muted">
                        <dt className="sr-only">Last studied</dt>
                        <dd>{formatDate(d.lastStudiedAt)}</dd>
                      </div>
                    </dl>
                    <div className="mt-1 h-[3px] bg-rule" aria-hidden>
                      <div className="h-full bg-accent" style={{ width: `${mastery}%` }} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Today's daily review: start / continue it, or see that it's done. */
function DailyCard({ daily }: { daily: Due["daily"] }) {
  const left = Math.max(0, daily.total - daily.answered);
  const minutes = Math.max(1, Math.round((left * 22) / 60));
  return (
    <div className="index-card basis-full px-5 pb-4 pt-3" data-testid="daily-card">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold leading-8">Daily review</h2>
          <p className="text-[0.95rem] text-muted" data-testid="daily-status">
            {daily.known === 0
              ? "Starts once you’ve learned a few words: it brings back what you already know, so it sticks."
              : daily.completed
                ? "Done for today. Your streak is safe."
                : daily.answered > 0
                  ? `${left} of ${daily.total} words left · about ${minutes} min`
                  : `${daily.total} words you know, the ones you miss most first · about ${minutes} min`}
          </p>
        </div>
        {daily.known > 0 &&
          (daily.completed ? (
            <Link href="/review" className="btn-secondary" data-testid="daily-start">
              Keep reviewing
            </Link>
          ) : (
            <Link href="/review" className="btn-primary px-5" data-testid="daily-start">
              {daily.answered > 0 ? "Continue daily review" : "Start daily review"}
            </Link>
          ))}
      </div>
    </div>
  );
}
