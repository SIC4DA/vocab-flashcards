import { eq } from "drizzle-orm";
import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { getOwnedSentence, localDay, saveSentenceProgress, toProgress } from "@/lib/data";
import type { CardProgress } from "@/lib/db/schema";
import { applySentenceAnswer } from "@/lib/sentences";
import { sentenceReviewSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Record one sentence exercise answer and move the sentence along its ladder. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await parseJson(req, sentenceReviewSchema);
  const { sentence, deck } = await getOwnedSentence(user.id, input.sentenceId);
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.sentenceProgress)
    .where(eq(schema.sentenceProgress.sentenceId, sentence.id))
    .limit(1);
  const now = new Date();
  const progress = applySentenceAnswer(
    toProgress(row as unknown as CardProgress | undefined),
    { correct: input.correct, type: input.type, hasReply: Boolean(sentence.reply), responseMs: input.responseMs },
    { today: localDay(now, input.tz ?? 0) },
    now,
  );
  await saveSentenceProgress(sentence.id, progress);
  await db.update(schema.decks).set({ lastStudiedAt: now }).where(eq(schema.decks.id, deck.id));
  return ok({ progress });
});
