import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { ApiError, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { userGeminiKey } from "@/lib/user-gemini";
import { geminiTts, pcmToWav, TTS_VOICE } from "@/lib/gemini";
import { geminiRateLimit } from "@/lib/rate-limit";
import { ttsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 25;

/** Gemini TTS (with the user's own key) → WAV, cached in Postgres by sha256(text+lang+voice). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const key = userGeminiKey(user);
  if (!key) throw new ApiError(404, "no_gemini_key", "Add your Gemini API key in Settings to use this feature");
  const { text, lang } = await parseJson(req, ttsSchema);
  const cacheKey = createHash("sha256").update(`${text}\u0000${lang}\u0000${TTS_VOICE}`).digest("hex");
  const db = await getDb();
  const [cached] = await db.select().from(schema.ttsCache).where(eq(schema.ttsCache.key, cacheKey)).limit(1);
  let wav: Buffer;
  if (cached) {
    wav = cached.audio;
  } else {
    await geminiRateLimit(user.id);
    try {
      const { pcm, sampleRate } = await geminiTts(key, text, lang);
      wav = pcmToWav(pcm, sampleRate);
    } catch (err) {
      console.warn("Gemini TTS failed:", err instanceof Error ? err.message : err);
      throw new ApiError(502, "tts_failed", "Cloud voice is unavailable right now");
    }
    await db.insert(schema.ttsCache).values({ key: cacheKey, audio: wav }).onConflictDoNothing();
  }
  return new Response(new Uint8Array(wav), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" },
  });
});
