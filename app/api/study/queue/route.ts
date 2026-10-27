import { ApiError, ok, requireUser, route } from "@/lib/api";
import {
  localDay,
  cardsForDecks,
  decksWithDueCards,
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
  planReviewSession,
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

const MODES = ["learn", "review", "flashcards", "write", "listen", "match", "test"] as const;
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

  let decks;
  let cards: StudyCard[];
  if (mode === "review") {
    decks = await decksWithDueCards(user.id, now);
    const deckById = new Map(decks.map((d) => [d.id, d]));
    cards = (await cardsForDecks(decks.map((d) => d.id))).map(({ deckId, dto }) =>
      toStudyCard(deckById.get(deckId)!, dto),
    );
  } else {
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
      questionTypeForStage(mode === "review" ? Math.max(1, c.progress.stage) : c.progress.stage, c.progress.correctStreak, {
        deckSize: peers(c).length,
        rand,
      }),
      peers(c),
      rand,
    );

  if (mode === "learn" || mode === "review") {
    // "Keep going" after the daily session: each bonus level allows one more step per word and 5 more new words.
    const bonus = Math.max(0, Math.min(3, Number(sp.get("bonus") ?? 0) || 0));
    const today = localDay(now, tz);
    const stepsPerDay = settings.stepsPerDay + bonus;
    let items: SessionItem[];
    let topic: string | null = null;
    let topics: ReturnType<typeof topicSummary> | null = null;
    if (mode === "learn") {
      newAllowed = newAllowedToday(settings, await newCardsIntroducedToday(user.id, localMidnight(now, tz))) + bonus * 5;
      const plan = planLearnSession(cards, { now, today, newAllowed, stepsPerDay });
      items = plan.items;
      topic = plan.topic?.label ?? null;
      topics = topicSummary(deckTopics(cards));
    } else {
      items = planReviewSession(cards, now);
    }
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
