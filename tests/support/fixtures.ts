import * as register from "@/app/api/auth/register/route";
import * as decks from "@/app/api/decks/route";
import * as deckCards from "@/app/api/decks/[id]/cards/route";
import { call } from "./route";

export async function registerUser(username: string, password = "password123") {
  const r = await call(register.POST, { body: { username, password } });
  if (r.status !== 201) throw new Error(`register failed: ${r.text}`);
  return { cookie: r.cookie!, user: r.json.user as { id: string; username: string } };
}

export async function createDeck(cookie: string, cards: { term: string; definition: string }[] = []) {
  const d = await call(decks.POST, { cookie, body: { title: "Spanish", termLang: "es-ES", definitionLang: "en-US" } });
  if (d.status !== 201) throw new Error(`deck failed: ${d.text}`);
  const deckId = d.json.deck.id as string;
  let saved: { id: string; term: string }[] = [];
  if (cards.length) {
    const r = await call(deckCards.PUT, { method: "PUT", cookie, params: { id: deckId }, body: { cards } });
    if (r.status !== 200) throw new Error(`cards failed: ${r.text}`);
    saved = r.json.cards;
  }
  return { deckId, cards: saved };
}
