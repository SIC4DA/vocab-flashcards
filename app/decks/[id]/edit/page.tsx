import type { Metadata } from "next";
import { DeckEditor } from "@/components/card-editor";
import { loadDeckForPage } from "@/lib/page-data";

export const metadata: Metadata = { title: "Edit deck" };

export default async function EditDeckPage({ params }: PageProps<"/decks/[id]/edit">) {
  const { id } = await params;
  const { deck, cards } = await loadDeckForPage(id);
  return <DeckEditor deck={deck} cards={cards} />;
}
