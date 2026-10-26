import { ApiError, ok, requireUser, route } from "@/lib/api";
import { userGeminiKey } from "@/lib/user-gemini";
import { geminiTranscribe } from "@/lib/gemini";
import { geminiRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 25;

const MAX_AUDIO_BYTES = 1024 * 1024;
const ALLOWED = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)(;.*)?$/;

/** Transcribe a short recording with Gemini (fallback when the browser has no SpeechRecognition). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const key = userGeminiKey(user);
  if (!key) throw new ApiError(404, "no_gemini_key", "Add your Gemini API key in Settings to use this feature");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 16 * 1024) {
    throw new ApiError(413, "too_large", "Recording must be 1 MB or smaller");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "invalid_upload", "Expected multipart form data");
  }
  const audio = form.get("audio");
  const lang = String(form.get("lang") ?? "").slice(0, 20);
  if (!(audio instanceof Blob) || !lang) throw new ApiError(400, "invalid_upload", "Missing audio or language");
  if (audio.size > MAX_AUDIO_BYTES) throw new ApiError(413, "too_large", "Recording must be 1 MB or smaller");
  const mime = audio.type || "audio/webm";
  if (!ALLOWED.test(mime)) throw new ApiError(415, "unsupported_type", "Unsupported audio format");
  await geminiRateLimit(user.id);
  try {
    const text = await geminiTranscribe(key, Buffer.from(await audio.arrayBuffer()), mime.split(";")[0], lang);
    return ok({ text });
  } catch (err) {
    console.warn("Gemini transcription failed:", err instanceof Error ? err.message : err);
    throw new ApiError(502, "transcribe_failed", "Transcription is unavailable right now");
  }
});
