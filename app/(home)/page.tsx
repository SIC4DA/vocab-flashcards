import Link from "next/link";
import { Dashboard } from "@/components/dashboard";
import { getCurrentUser } from "@/lib/current-user";
import { listDecks } from "@/lib/data";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return <Landing />;
  const decks = await listDecks(user.id);
  return <Dashboard initialDecks={decks} />;
}

function Landing() {
  const features = [
    ["🃏", "Flashcards with audio", "Flip cards, hear native-like pronunciation, and sort what you know."],
    ["🧠", "Adaptive Learn mode", "Each word climbs from recognising it to writing it."],
    ["⏰", "Spaced repetition", "Reviews come back right before you'd forget them."],
    ["🎧", "Listen and write", "Native-speaker recordings, dictation, and typing with accent help."],
    ["🖼️", "Automatic images", "Openly licensed pictures are found for every word."],
    ["🎯", "Match & Test", "Race the clock or take a generated exam."],
  ];
  return (
    <div className="py-8 sm:py-14">
      <section className="text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          Learn vocabulary <span className="text-accent">that sticks</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
          Build decks of words with pictures and pronunciation, then practise them with flashcards, listening and writing —
          scheduled by spaced repetition.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/register" className="btn-primary px-6 text-lg">
            Get started — it&apos;s free
          </Link>
          <Link href="/login" className="btn-secondary px-6 text-lg">
            Log in
          </Link>
          <Link href="/help" className="btn-ghost px-6 text-lg">
            How it works
          </Link>
        </div>
      </section>
      <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Features">
        {features.map(([icon, title, text]) => (
          <div key={title} className="panel p-5">
            <div aria-hidden className="text-3xl">
              {icon}
            </div>
            <h2 className="mt-2 font-bold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
