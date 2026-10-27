import { ApiError, ok, requireUser, route } from "@/lib/api";
import { findRecording } from "@/lib/pronounce";

export const runtime = "nodejs";
export const maxDuration = 20;

/** Native-speaker recording for a word (Wiktionary / Wikimedia Commons), or nulls when none exists. */
export const GET = route(async (req) => {
  await requireUser(req);
  const text = req.nextUrl.searchParams.get("text") ?? "";
  const lang = req.nextUrl.searchParams.get("lang") ?? "";
  if (!text.trim() || text.length > 200 || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) {
    throw new ApiError(400, "validation_error", "Invalid text or language");
  }
  const rec = await findRecording(text, lang);
  return ok(rec, { headers: { "Cache-Control": "private, max-age=86400" } });
});
