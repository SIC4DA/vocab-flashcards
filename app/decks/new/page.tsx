import type { Metadata } from "next";
import { DeckEditor } from "@/components/card-editor";

export const metadata: Metadata = { title: "New deck" };

export default function NewDeckPage() {
  return <DeckEditor />;
}
