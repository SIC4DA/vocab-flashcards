import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudyLoader, type StudyMode } from "@/components/study/study-loader";
import { loadDeckForPage } from "@/lib/page-data";

const MODES: StudyMode[] = ["learn", "flashcards", "write", "listen", "speak", "match", "test"];
const TITLES: Record<string, string> = {
  learn: "Learn",
  flashcards: "Flashcards",
  write: "Write",
  listen: "Listen",
  speak: "Speak",
  match: "Match",
  test: "Test",
};

export async function generateMetadata({ params }: PageProps<"/decks/[id]/study/[mode]">): Promise<Metadata> {
  const { mode } = await params;
  return { title: TITLES[mode] ?? "Study" };
}

export default async function StudyPage({ params }: PageProps<"/decks/[id]/study/[mode]">) {
  const { id, mode } = await params;
  if (!MODES.includes(mode as StudyMode)) notFound();
  const { deck, cards } = await loadDeckForPage(id);
  if (cards.length === 0) notFound();
  return (
    <StudyLoader
      mode={mode as StudyMode}
      deckId={deck.id}
      title={`${TITLES[mode]}: ${deck.title}`}
      cardCount={cards.length}
      matchBestMs={deck.matchBestMs}
    />
  );
}
