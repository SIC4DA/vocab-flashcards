import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { geminiImageKeyword } from "./gemini";
import { pickBestImage, searchImages } from "./images";
import { isEnglish } from "./languages";

/** Build the image search query for a card: the definition, or a Gemini keyword for non-English definitions. */
export async function imageQueryFor(
  definition: string,
  definitionLang: string,
  geminiKey: string | null,
): Promise<string> {
  const base = definition.split(/[/;]/)[0].trim();
  if (!isEnglish(definitionLang) && geminiKey) {
    try {
      return await geminiImageKeyword(geminiKey, base, definitionLang);
    } catch (err) {
      console.warn("Gemini keyword failed:", err instanceof Error ? err.message : err);
    }
  }
  return base;
}

/** Find and store an image for a card that has none. Never throws; returns the stored URL or null. */
export async function autoFillImage(
  card: { id: string; definition: string; imageUrl: string | null; hasUpload: boolean },
  definitionLang: string,
  geminiKey: string | null,
): Promise<{ imageUrl: string; imageAttribution: string } | null> {
  if (card.imageUrl || card.hasUpload) return null;
  try {
    const q = await imageQueryFor(card.definition, definitionLang, geminiKey);
    const best = pickBestImage(await searchImages(q, 10));
    if (!best) return null;
    const db = await getDb();
    await db
      .update(schema.cards)
      .set({ imageUrl: best.thumbUrl, imageAttribution: best.attribution })
      .where(eq(schema.cards.id, card.id));
    return { imageUrl: best.thumbUrl, imageAttribution: best.attribution };
  } catch (err) {
    console.warn("Auto image failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
