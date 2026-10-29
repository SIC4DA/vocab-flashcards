import Link from "next/link";
import { Dashboard } from "@/components/dashboard";
import { DemoCard } from "@/components/demo-card";
import { getCurrentUser } from "@/lib/current-user";
import { listDecks } from "@/lib/data";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return <Landing />;
  const decks = await listDecks(user.id);
  return <Dashboard initialDecks={decks} />;
}

function Landing() {
  const steps = [
    ["See it", "The word, its meaning, a picture, and a native speaker saying it."],
    ["Pick its meaning", "Multiple choice, from the other words in your deck."],
    ["Hear it", "Recognise the word by sound alone."],
    ["Write what you hear", "Dictation, with a bar for ä, ß, é and friends."],
    ["Write it from its meaning", "No hints. Now it’s yours."],
    ["Review it later", "It comes back after a day, a week, then longer — right before you’d forget it."],
  ];
  const extras = [
    ["Native recordings", "Real speakers from Wiktionary for most single words, your device’s best voice for the rest."],
    ["Pictures only where they help", "A photo for a towel or a sausage; none for “to spell”."],
    ["Sentences", "Unlock a sentence by mastering its words, then fill gaps, order words, and match questions to replies."],
    ["Match and Test", "Pair words against the clock, or take an exam built from your deck."],
  ];
  return (
    <div className="space-y-20 pb-10 pt-6 sm:pt-14">
      <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-[2.6rem] leading-[1.08] font-semibold tracking-[-0.025em] sm:text-[3.6rem]">
            A few new words a day, and they stay.
          </h1>
          <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-muted">
            Make index cards with a word, its meaning and a picture. A short session each day takes every word from first
            sight to writing it from memory, then brings it back just before you’d forget it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/register" className="btn-primary px-6">
              Create a free account
            </Link>
            <Link href="/login" className="btn-secondary px-6">
              Log in
            </Link>
            <Link href="/help" className="btn-ghost text-accent">
              How it works
            </Link>
          </div>
        </div>
        <DemoCard />
      </section>

      <section aria-labelledby="ladder-h">
        <h2 id="ladder-h" className="text-[1.75rem] font-semibold">
          How a word is learned
        </h2>
        <ol className="mt-6 grid gap-x-10 border-t border-line sm:grid-cols-2 lg:grid-cols-3">
          {steps.map(([title, text], i) => (
            <li key={title} className="border-b border-line py-5">
              <p className="flex items-baseline gap-3">
                <span className="font-display text-lg text-margin tabular-nums">{i + 1}</span>
                <span className="font-display text-lg font-semibold">{title}</span>
              </p>
              <p className="mt-1 pl-7 text-[0.95rem] text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="extras-h" className="grid gap-8 lg:grid-cols-[1fr_2fr]">
        <h2 id="extras-h" className="text-[1.75rem] font-semibold">
          Also in the box
        </h2>
        <dl className="divide-y divide-line border-y border-line">
          {extras.map(([title, text]) => (
            <div key={title} className="grid gap-1 py-4 sm:grid-cols-[13rem_1fr]">
              <dt className="font-semibold">{title}</dt>
              <dd className="text-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
