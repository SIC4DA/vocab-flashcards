import { DeckOverview } from "@/components/deck-overview";
import { loadDeckForPage } from "@/lib/page-data";

export default async function DeckPage({ params }: PageProps<"/decks/[id]">) {
  const { id } = await params;
  const { deck, cards, sentences } = await loadDeckForPage(id);
  return <DeckOverview deck={deck} cards={cards} sentences={sentences} />;
}
