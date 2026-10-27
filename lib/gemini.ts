import "server-only";
import { apiBase, geminiModel, geminiTtsModel } from "./env";
import { fetchWithTimeout } from "./http";
import { languageName } from "./languages";

export class GeminiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };
type GenerateResponse = { candidates?: { content?: { parts?: Part[] } }[] };

export const TTS_VOICE = "Kore";

async function call(key: string, model: string, body: unknown): Promise<GenerateResponse> {
  if (!key) throw new GeminiError("No Gemini API key");
  const url = `${apiBase.gemini()}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let lastErr: GeminiError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
        },
        10_000,
      );
      if (res.ok) return (await res.json()) as GenerateResponse;
      lastErr = new GeminiError(`Gemini request failed (${res.status})`, res.status);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastErr = new GeminiError(err instanceof Error && err.name === "AbortError" ? "Gemini timed out" : "Gemini network error");
    }
  }
  throw lastErr ?? new GeminiError("Gemini request failed");
}

function textOf(res: GenerateResponse): string {
  return (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

async function generateJson<T>(key: string, prompt: string): Promise<T> {
  const res = await call(key, geminiModel(), {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
  });
  const text = textOf(res).replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError("Gemini returned invalid JSON");
  }
}

export async function geminiTranslate(
  key: string,
  text: string,
  from: string,
  to: string,
): Promise<{ translation: string; example?: string }> {
  const out = await generateJson<{ translation?: string; example?: string }>(
    key,
    `You help build vocabulary flashcards. Translate the ${languageName(from)} word or phrase below into ${languageName(to)}. ` +
      `Give the most common meaning, short (max 6 words). Also write one short, simple example sentence in ${languageName(from)} that uses it. ` +
      `Reply as JSON: {"translation": string, "example": string}.\n\nWord: ${JSON.stringify(text)}`,
  );
  if (!out.translation || typeof out.translation !== "string") throw new GeminiError("Empty translation");
  return { translation: out.translation.trim(), example: typeof out.example === "string" ? out.example.trim() : undefined };
}

export async function geminiImageKeyword(key: string, text: string, lang: string): Promise<string> {
  const out = await generateJson<{ keyword?: string }>(
    key,
    `Give the best 1-3 word English search keyword to find a photo that illustrates this ${languageName(lang)} word or phrase. ` +
      `Reply as JSON: {"keyword": string}.\n\nText: ${JSON.stringify(text)}`,
  );
  const kw = (out.keyword ?? "").trim().split(/\s+/).slice(0, 3).join(" ");
  if (!kw) throw new GeminiError("Empty keyword");
  return kw;
}

export async function geminiGenerateDeck(
  key: string,
  topic: string,
  termLang: string,
  definitionLang: string,
  count: number,
): Promise<unknown> {
  return generateJson<unknown>(
    key,
    `Create ${count} vocabulary flashcards about the topic ${JSON.stringify(topic)} for a learner of ${languageName(termLang)} ` +
      `whose own language is ${languageName(definitionLang)}. Each card: "term" (word or short phrase in ${languageName(termLang)}, ` +
      `include the article for nouns where the language uses them), "definition" (its meaning in ${languageName(definitionLang)}, short), ` +
      `"example" (one short simple sentence in ${languageName(termLang)}). Reply as a JSON array of objects with keys term, definition, example. No duplicates.`,
  );
}

/**
 * One request for a batch of cards: does each word need a picture, a good image-search keyword,
 * and a topic group (reusing existing topic names).
 */
export async function geminiOrganize(
  key: string,
  items: { term: string; definition: string }[],
  termLang: string,
  existingGroups: string[],
): Promise<unknown> {
  const list = items.map((c, i) => ({ i, term: c.term, meaning: c.definition }));
  return generateJson<unknown>(
    key,
    `You organise vocabulary flashcards for a learner of ${languageName(termLang)}.\n` +
      `For EACH card return an object {"i": number, "image": boolean, "keyword": string, "group": string}.\n` +
      `- "image": true only if a photo clearly shows the meaning and helps remember it: concrete objects, food, animals, ` +
      `plants, places, buildings, vehicles, clothing, body parts, colours, weather, people/jobs, and clearly visible ` +
      `physical actions (swim, eat, run). false for abstract nouns, most verbs (e.g. spell, think, believe, decide, ` +
      `need), adjectives that can't be photographed, adverbs, pronouns, prepositions, conjunctions, numbers and phrases.\n` +
      `- "keyword": 1-3 English words to search a stock photo (empty string when image is false).\n` +
      `- "group": a short English topic label of 1-3 words, by theme or situation (e.g. "Kitchen", "Food", "Travel", ` +
      `"Feelings", "Everyday verbs"), aiming for 3-10 cards per topic. Do not group by grammar alone unless nothing else fits. ` +
      (existingGroups.length ? `Reuse these existing topics when they fit: ${JSON.stringify(existingGroups.slice(0, 40))}.\n` : "\n") +
      `Reply with a JSON array only, one object per card, same "i" values.\n\nCards: ${JSON.stringify(list)}`,
  );
}

/** Returns raw 16-bit PCM (24 kHz mono) from Gemini TTS. */
export async function geminiTts(key: string, text: string, lang: string): Promise<{ pcm: Buffer; sampleRate: number }> {
  const res = await call(key, geminiTtsModel(), {
    contents: [{ role: "user", parts: [{ text: `Say clearly in ${languageName(lang)}: ${text}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
    },
  });
  const part = (res.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part?.inlineData) throw new GeminiError("No audio returned");
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
  return { pcm: Buffer.from(part.inlineData.data, "base64"), sampleRate: rate };
}

/** Wrap 16-bit little-endian mono PCM in a WAV container. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export type KeyCheck = { status: "valid" | "invalid" | "unreachable"; message?: string };

/**
 * Checks a key with a free countTokens call on the configured model (this proves the key may call the
 * Gemini API, which AI Studio's newer "AQ." auth keys are restricted to). Falls back to listing models
 * if the model name is unknown. A 429 counts as valid: the key works but its quota is used up right now.
 */
export async function verifyGeminiKey(key: string): Promise<KeyCheck> {
  const headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
  try {
    let res = await fetchWithTimeout(`${apiBase.gemini()}/v1beta/models/${encodeURIComponent(geminiModel())}:countTokens`, {
      method: "POST",
      headers,
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] }),
    });
    if (res.status === 404) res = await fetchWithTimeout(`${apiBase.gemini()}/v1beta/models?pageSize=1`, { headers });
    if (res.ok || res.status === 429) return { status: "valid" };
    if (res.status >= 500) return { status: "unreachable" };
    let message: string | undefined;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body.error?.message?.slice(0, 300);
    } catch {
      message = undefined;
    }
    return { status: "invalid", message };
  } catch {
    return { status: "unreachable" };
  }
}
