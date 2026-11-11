import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { geminiImageKeyword } from "./gemini";
import { pickBestImage, searchImages } from "./images";
import { isEnglish } from "./languages";

/**
 * Without AI, English definitions that start with "to …" are verbs; stock photos rarely explain
 * them ("to spell", "to need"), so no picture is searched. The user can still choose one.
 */
export function looksUnpicturable(definition: string, definitionLang: string): boolean {
  return isEnglish(definitionLang) && /^to\s+\S/i.test(definition.trim());
}

/** Build the image search query: AI keyword if known, a Gemini keyword for non-English definitions, else the definition. */
export async function imageQueryFor(
  definition: string,
  definitionLang: string,
  geminiKey: string | null,
  imageQuery?: string | null,
): Promise<string> {
  if (imageQuery?.trim()) return imageQuery.trim();
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

export type AutoImageResult = { imageUrl: string; imageAttribution: string } | { noImage: true } | null;

/** Find and store an image for a card that has none and needs one. Never throws. */
export async function autoFillImage(
  card: {
    id: string;
    definition: string;
    imageUrl: string | null;
    hasUpload: boolean;
    noImage?: boolean;
    imageQuery?: string | null;
  },
  definitionLang: string,
  geminiKey: string | null,
): Promise<AutoImageResult> {
  if (card.imageUrl || card.hasUpload || card.noImage) return null;
  try {
    const db = await getDb();
    // Clearly a verb or abstract word → skip the picture.
    if (!card.imageQuery && looksUnpicturable(card.definition, definitionLang)) {
      await db.update(schema.cards).set({ noImage: true }).where(eq(schema.cards.id, card.id));
      return { noImage: true };
    }
    const q = await imageQueryFor(card.definition, definitionLang, geminiKey, card.imageQuery);
    const best = pickBestImage(await searchImages(q, 10));
    if (!best) return null;
    await db
      .update(schema.cards)
      .set({ imageUrl: best.thumbUrl, imageAttribution: best.attribution, imageSource: "auto" })
      .where(eq(schema.cards.id, card.id));
    return { imageUrl: best.thumbUrl, imageAttribution: best.attribution };
  } catch (err) {
    console.warn("Auto image failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
