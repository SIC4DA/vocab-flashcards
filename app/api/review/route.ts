import { eq } from "drizzle-orm";
import { ok, parseJson, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { applyDailyAnswer } from "@/lib/daily";
import { getOwnedCard, localDay, markDailyAnswered, saveProgress, toProgress, type DailyStatus } from "@/lib/data";
import { applyAnswer, applyFlashcardMark, applyView, bumpStats, type QuestionType } from "@/lib/learn";
import type { Grade } from "@/lib/srs";
import { resolveSettings, reviewSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Record one answer: updates card_progress (ladder + SRS) and appends to review_log.
 * Daily review answers also tick off today's word list; Articles & plurals answers only count in the stats.
 */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await parseJson(req, reviewSchema);
  const { card, deck } = await getOwnedCard(user.id, input.cardId);
  const settings = resolveSettings(user.settings);
  const db = await getDb();
  const [row] = await db.select().from(schema.cardProgress).where(eq(schema.cardProgress.cardId, card.id)).limit(1);
  const current = toProgress(row);
  const now = new Date();

  const type = input.questionType ?? (input.mode === "listen" ? "dictation" : "write");
  let result;
  const grammar = input.mode === "grammar" || type === "article" || type === "plural";
  if (grammar) {
    result = {
      progress: { ...current, modeStats: bumpStats(current.modeStats, type, input.correct) },
      previousStage: current.stage,
      stageChanged: 0,
    };
  } else if (input.mode === "daily") {
    result = applyDailyAnswer(
      current,
      { correct: input.correct, grade: input.grade as Grade | undefined, type: type as QuestionType, responseMs: input.responseMs },
      now,
    );
  } else if (input.mode === "flashcards") {
    result = applyFlashcardMark(current, input.known ?? input.correct, now);
  } else if (input.questionType === "flashcard") {
    result = applyView(current, now, localDay(now, input.tz ?? 0));
  } else {
    result = applyAnswer(
      current,
      {
        correct: input.correct,
        grade: input.grade as Grade | undefined,
        type: type as QuestionType,
        ladder: input.mode === "learn" || input.mode === "review",
        responseMs: input.responseMs,
      },
      { advanceAfter: settings.advanceAfter, today: localDay(now, input.tz ?? 0) },
      now,
    );
  }

  await db.transaction(async (tx) => {
    await saveProgress(card.id, result.progress, tx);
    // A word first played in Articles & plurals (stage 0) is "introduced" when Learn first shows it.
    if (row && row.stage === 0 && result.progress.stage >= 1) {
      await tx.update(schema.cardProgress).set({ createdAt: now }).where(eq(schema.cardProgress.cardId, card.id));
    }
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

  let daily: DailyStatus | undefined;
  if (input.mode === "daily") daily = await markDailyAnswered(user.id, localDay(now, input.tz ?? 0), card.id);

  return ok({ ...result, daily });
});
