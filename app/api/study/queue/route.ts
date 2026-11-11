import { ApiError, ok, requireUser, route } from "@/lib/api";
import { DAILY_MIN_STAGE, DAILY_SIZE, EXTRA_SIZE, planDailyReview } from "@/lib/daily";
import {
  localDay,
  createDailyReview,
  dailyPool,
  dailyStatus,
  getDailyReview,
  getDeckCards,
  getOwnedDeck,
  localMidnight,
  newAllowedToday,
  newCardsIntroducedToday,
  toDeckDTO,
  toStudyCard,
} from "@/lib/data";
import {
  buildQuestion,
  buildTest,
  questionTypeForStage,
  deckTopics,
  nextRoundIds,
  planLearnSession,
  reviewQuestionType,
  shuffle,
  topicSummary,
  type SessionItem,
  type Question,
  type QuestionType,
  type StudyCard,
  type TestType,
} from "@/lib/learn";
import { resolveSettings } from "@/lib/validation";

export const runtime = "nodejs";

export type LearnSession = {
  items: SessionItem[];
  /** Local day the session belongs to (YYYY-MM-DD). */
  today: string;
  stepsPerDay: number;
  /** Topic new words come from today (null for reviews / when the deck is finished). */
  topic: string | null;
  topics: ReturnType<typeof topicSummary> | null;
  bonus: number;
};

const MODES = ["learn", "daily", "flashcards", "write", "listen", "match", "test", "grammar"] as const;
type Mode = (typeof MODES)[number];
const TEST_TYPES: TestType[] = ["mc", "write", "dictation", "true_false"];

const FIXED_TYPE: Partial<Record<Mode, QuestionType>> = {
  flashcards: "flashcard",
  write: "write",
  listen: "dictation",
};

/** Build the ordered questions for a study session (including distractors). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") as Mode | null;
  if (!mode || !MODES.includes(mode)) throw new ApiError(400, "validation_error", "Unknown study mode");
  const settings = resolveSettings(user.settings);
  const tz = Math.max(-840, Math.min(840, Number(sp.get("tz") ?? 0) || 0));
  const now = new Date();
  const rand = Math.random;

  if (mode === "daily") return ok(await dailyQueue(user.id, now, tz, Number(sp.get("bonus") ?? 0) || 0));

  let decks;
  let cards: StudyCard[];
  {
    const deck = await getOwnedDeck(user.id, sp.get("deckId") ?? "");
    decks = [deck];
    cards = (await getDeckCards(deck.id)).map((c) => toStudyCard(deck, c));
  }

  const deckSizes = new Map<string, StudyCard[]>();
  for (const c of cards) deckSizes.set(c.deckId, [...(deckSizes.get(c.deckId) ?? []), c]);
  const peers = (c: StudyCard) => deckSizes.get(c.deckId) ?? [];

  let questions: Question[] = [];
  let newAllowed = 0;
  let session: LearnSession | null = null;
  const questionFor = (c: StudyCard) =>
    buildQuestion(
      c,
      questionTypeForStage(c.progress.stage, c.progress.correctStreak, {
        deckSize: peers(c).length,
        rand,
      }),
      peers(c),
      rand,
    );

  if (mode === "learn") {
    // "Keep going" after the daily session: each bonus level allows one more step per word and 5 more new words.
    const bonus = Math.max(0, Math.min(3, Number(sp.get("bonus") ?? 0) || 0));
    const today = localDay(now, tz);
    const stepsPerDay = settings.stepsPerDay + bonus;
    newAllowed = newAllowedToday(settings, await newCardsIntroducedToday(user.id, localMidnight(now, tz))) + bonus * 5;
    const plan = planLearnSession(cards, { now, today, newAllowed, stepsPerDay });
    const items: SessionItem[] = plan.items;
    const topic = plan.topic?.label ?? null;
    const topics = topicSummary(deckTopics(cards));
    const byId = new Map(cards.map((c) => [c.id, c]));
    const first = nextRoundIds(items, (id) => byId.get(id)!.progress, { today, stepsPerDay, roundSize: settings.roundSize });
    questions = first.map((id) => questionFor(byId.get(id)!));
    session = { items, today, stepsPerDay, topic, topics, bonus };
  } else if (mode === "test") {
    const types = (sp.get("types") ?? "mc,write,dictation,true_false")
      .split(",")
      .filter((t): t is TestType => TEST_TYPES.includes(t as TestType));
    const only = new Set((sp.get("cardIds") ?? "").split(",").filter(Boolean));
    const pool = only.size ? cards.filter((c) => only.has(c.id)) : cards;
    const count = Math.max(1, Math.min(pool.length, Number(sp.get("count") ?? 10) || 10));
    questions = pool.length ? buildTest(pool, { count, types }, rand).map((q) => {
      // Distractors always come from the whole deck, even when retaking missed cards only.
      if (q.type === "mc" || q.type === "true_false") {
        const card = pool.find((c) => c.id === q.cardId)!;
        return buildQuestion(card, q.type, cards, rand);
      }
      return q;
    }) : [];
  } else if (FIXED_TYPE[mode]) {
    const type = FIXED_TYPE[mode]!;
    // Write / Listen use random order; Flashcards keep deck order (shuffle is a UI toggle).
    const ordered = mode === "flashcards" ? cards : shuffle(cards, rand);
    questions = ordered.map((c) => buildQuestion(c, type, cards, rand));
  }

  return ok({
    mode,
    decks: decks.map(toDeckDTO),
    cards,
    questions,
    newAllowed,
    session,
  });
});

/**
 * Daily review: today's fixed word list (picked on the first visit of the day), minus words already answered.
 * `bonus` > 0 is "Keep reviewing": another short batch of known words not reviewed today.
 */
async function dailyQueue(userId: string, now: Date, tz: number, bonus: number) {
  const today = localDay(now, tz);
  const rand = Math.random;
  // Every word with progress, so today's list still resolves if a word slipped back a stage since the morning.
  const all = await dailyPool(userId, 1);
  const byId = new Map(all.map((c) => [c.id, c]));
  let row = await getDailyReview(userId, today);
  let picked: StudyCard[];
  if (bonus > 0) {
    const reviewedToday = all.filter((c) => c.progress.lastReviewedAt && localDay(new Date(c.progress.lastReviewedAt), tz) === today);
    const exclude = new Set([...(row?.cardIds ?? []), ...reviewedToday.map((c) => c.id)]);
    picked = planDailyReview(all, now, { size: EXTRA_SIZE, exclude });
  } else {
    if (!row) {
      const plan = planDailyReview(all, now, { size: DAILY_SIZE });
      if (plan.length) row = await createDailyReview(userId, today, plan.map((c) => c.id));
    }
    const answered = new Set(row?.answeredIds ?? []);
    picked = row && !row.completedAt ? row.cardIds.filter((id) => !answered.has(id) && byId.has(id)).map((id) => byId.get(id)!) : [];
    picked = shuffle(picked, rand);
  }
  const deckPeers = new Map<string, StudyCard[]>();
  for (const c of all) deckPeers.set(c.deckId, [...(deckPeers.get(c.deckId) ?? []), c]);
  const questions = picked.map((c) => {
    const peers = deckPeers.get(c.deckId) ?? [c];
    return buildQuestion(c, reviewQuestionType(rand, peers.length), peers, rand);
  });
  return {
    mode: "daily",
    decks: [],
    cards: picked,
    questions,
    newAllowed: 0,
    session: null,
    daily: { ...dailyStatus(row, today), known: all.filter((c) => c.progress.stage >= DAILY_MIN_STAGE).length, bonus },
  };
}
