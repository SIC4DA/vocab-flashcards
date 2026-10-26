import { ApiError, ok, requireUser, route } from "@/lib/api";
import {
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
  isCardDue,
  questionTypeForStage,
  selectRound,
  shuffle,
  type Question,
  type QuestionType,
  type StudyCard,
  type TestType,
} from "@/lib/learn";
import { resolveSettings } from "@/lib/validation";

export const runtime = "nodejs";

const MODES = ["learn", "review", "flashcards", "write", "listen", "speak", "match", "test"] as const;
type Mode = (typeof MODES)[number];
const TEST_TYPES: TestType[] = ["mc", "write", "dictation", "speak", "true_false"];

const FIXED_TYPE: Partial<Record<Mode, QuestionType>> = {
  flashcards: "flashcard",
  write: "write",
  listen: "dictation",
  speak: "speak",
};

/** Build the ordered questions for a study session (including distractors). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") as Mode | null;
  if (!mode || !MODES.includes(mode)) throw new ApiError(400, "validation_error", "Unknown study mode");
  const settings = resolveSettings(user.settings);
  const speakAvailable = sp.get("speak") === "1" && settings.enableSpeaking;
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
  if (mode === "learn") {
    newAllowed = newAllowedToday(settings, await newCardsIntroducedToday(user.id, localMidnight(now, tz)));
    const round = selectRound(cards, { now, newAllowed, roundSize: settings.roundSize });
    questions = round.map((c) =>
      buildQuestion(
        c,
        questionTypeForStage(c.progress.stage, c.progress.correctStreak, {
          speakAvailable,
          deckSize: peers(c).length,
          rand,
        }),
        peers(c),
        rand,
      ),
    );
  } else if (mode === "review") {
    const due = cards
      .filter((c) => isCardDue(c, now))
      .sort((a, b) => new Date(a.progress.dueAt!).getTime() - new Date(b.progress.dueAt!).getTime());
    questions = due.map((c) =>
      buildQuestion(
        c,
        questionTypeForStage(Math.max(1, c.progress.stage), c.progress.correctStreak, {
          speakAvailable,
          deckSize: peers(c).length,
          rand,
        }),
        peers(c),
        rand,
      ),
    );
  } else if (mode === "test") {
    const types = (sp.get("types") ?? "mc,write,dictation,speak,true_false")
      .split(",")
      .filter((t): t is TestType => TEST_TYPES.includes(t as TestType));
    const only = new Set((sp.get("cardIds") ?? "").split(",").filter(Boolean));
    const pool = only.size ? cards.filter((c) => only.has(c.id)) : cards;
    const count = Math.max(1, Math.min(pool.length, Number(sp.get("count") ?? 10) || 10));
    questions = pool.length ? buildTest(pool, { count, types, speakAvailable }, rand).map((q) => {
      // Distractors always come from the whole deck, even when retaking missed cards only.
      if (q.type === "mc" || q.type === "true_false") {
        const card = pool.find((c) => c.id === q.cardId)!;
        return buildQuestion(card, q.type, cards, rand);
      }
      return q;
    }) : [];
  } else if (FIXED_TYPE[mode]) {
    const type = FIXED_TYPE[mode]!;
    // Write / Listen / Speak use random order; Flashcards keep deck order (shuffle is a UI toggle).
    const ordered = mode === "flashcards" ? cards : shuffle(cards, rand);
    questions = ordered.map((c) => buildQuestion(c, type === "speak" && !speakAvailable ? "write" : type, cards, rand));
  }

  return ok({
    mode,
    decks: decks.map(toDeckDTO),
    cards,
    questions,
    newAllowed,
    speakAvailable,
  });
});
