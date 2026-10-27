import { ApiError, ok, requireUser, route } from "@/lib/api";
import {
  examplesFromSentences,
  getDeckSentences,
  toStudySentence,
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
import {
  buildSentenceQuestion,
  planSentences,
  SENTENCE_MASTERED,
  sentenceTypeForStage,
  type SentenceQuestion,
  type StudySentence,
} from "@/lib/sentences";
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

const MODES = ["learn", "review", "flashcards", "write", "listen", "match", "test", "sentences"] as const;
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
  let sentences: StudySentence[];
  if (mode === "review") {
    decks = await decksWithDueCards(user.id, now);
    const deckById = new Map(decks.map((d) => [d.id, d]));
    cards = (await cardsForDecks(decks.map((d) => d.id))).map(({ deckId, dto }) =>
      toStudyCard(deckById.get(deckId)!, dto),
    );
    sentences = [];
  } else {
    const deck = await getOwnedDeck(user.id, sp.get("deckId") ?? "");
    decks = [deck];
    const dtos = await getDeckCards(deck.id);
    const sentenceDtos = await getDeckSentences(deck.id, new Map(dtos.map((c) => [c.id, c.progress.stage])));
    // Words without their own example borrow one from the deck's sentences (shown on the card back).
    const examples = examplesFromSentences(sentenceDtos);
    cards = dtos.map((c) => {
      const sc = toStudyCard(deck, c);
      const ex = examples.get(c.id);
      return !sc.example && ex ? { ...sc, example: ex.text, exampleTranslation: ex.translation } : sc;
    });
    sentences = sentenceDtos.map((x) => toStudySentence(deck, x));
  }

  const deckSizes = new Map<string, StudyCard[]>();
  for (const c of cards) deckSizes.set(c.deckId, [...(deckSizes.get(c.deckId) ?? []), c]);
  const peers = (c: StudyCard) => deckSizes.get(c.deckId) ?? [];

  let questions: (Question | SentenceQuestion)[] = [];
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

  if (mode === "learn" || mode === "review" || mode === "sentences") {
    // "Keep going" after the daily session: each bonus level allows one more step per word and 5 more new words.
    const bonus = Math.max(0, Math.min(3, Number(sp.get("bonus") ?? 0) || 0));
    const today = localDay(now, tz);
    const stepsPerDay = settings.stepsPerDay + bonus;
    let items: SessionItem[];
    let topic: string | null = null;
    let topics: ReturnType<typeof topicSummary> | null = null;
    const sentenceItems = (limit: number): SessionItem[] =>
      planSentences(sentences, { now, today, stepsPerDay, limit }).map((x) => ({
        id: x.id,
        kind: x.progress.stage >= SENTENCE_MASTERED ? ("sentence_review" as const) : ("sentence" as const),
      }));
    if (mode === "learn") {
      newAllowed = newAllowedToday(settings, await newCardsIntroducedToday(user.id, localMidnight(now, tz))) + bonus * 5;
      const plan = planLearnSession(cards, { now, today, newAllowed, stepsPerDay });
      // Unlocked sentences join the end of the daily session.
      items = [...plan.items, ...sentenceItems(settings.sentencesPerDay + bonus * 3)];
      topic = plan.topic?.label ?? null;
      topics = topicSummary(deckTopics(cards));
    } else if (mode === "sentences") {
      items = sentenceItems(20 + bonus * 10);
    } else {
      items = planReviewSession(cards, now);
    }
    const byId = new Map(cards.map((c) => [c.id, c]));
    const sById = new Map(sentences.map((x) => [x.id, x]));
    const progressOf = (id: string) => (byId.get(id) ?? sById.get(id)!).progress;
    const first = nextRoundIds(items, progressOf, { today, stepsPerDay, roundSize: settings.roundSize });
    questions = first.map((id) => {
      const st = sById.get(id);
      if (!st) return questionFor(byId.get(id)!);
      return buildSentenceQuestion(st, sentenceTypeForStage(st, st.progress.stage, rand), {
        cards,
        peers: sentences.filter((x) => x.unlocked),
        rand,
      });
    });
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
    sentences,
  });
});
