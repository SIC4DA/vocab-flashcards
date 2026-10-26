import { eq } from "drizzle-orm";
import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { getOwnedCard, saveProgress, toProgress } from "@/lib/data";
import { applyAnswer, applyFlashcardMark, applyView } from "@/lib/learn";
import type { Grade } from "@/lib/srs";
import { resolveSettings, reviewSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Record one answer: updates card_progress (ladder + SRS) and appends to review_log. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await parseJson(req, reviewSchema);
  const { card, deck } = await getOwnedCard(user.id, input.cardId);
  const settings = resolveSettings(user.settings);
  const db = await getDb();
  const [row] = await db.select().from(schema.cardProgress).where(eq(schema.cardProgress.cardId, card.id)).limit(1);
  const current = toProgress(row);
  const now = new Date();

  let result;
  if (input.mode === "flashcards") {
    result = applyFlashcardMark(current, input.known ?? input.correct, now);
  } else if (input.questionType === "flashcard") {
    result = applyView(current, now);
  } else {
    result = applyAnswer(
      current,
      {
        correct: input.correct,
        grade: input.grade as Grade | undefined,
        type: input.questionType ?? (input.mode === "speak" ? "speak" : input.mode === "listen" ? "dictation" : "write"),
        ladder: input.mode === "learn" || input.mode === "review",
        responseMs: input.responseMs,
      },
      { advanceAfter: settings.advanceAfter, speakAvailable: Boolean(input.speakAvailable) && settings.enableSpeaking },
      now,
    );
  }

  await db.transaction(async (tx) => {
    await saveProgress(card.id, result.progress, tx);
    await tx.insert(schema.reviewLog).values({
      cardId: card.id,
      userId: user.id,
      mode: input.mode,
      correct: input.correct,
      answerGiven: input.answerGiven,
      responseMs: input.responseMs,
    });
    await tx.update(schema.decks).set({ lastStudiedAt: now }).where(eq(schema.decks.id, deck.id));
  });

  return ok(result);
});
