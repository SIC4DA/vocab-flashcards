import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  real,
  index,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return Buffer.from(value);
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull(),
  usernameNormalized: text("username_normalized").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  /** The user's own Gemini API key, encrypted (AES-256-GCM, see lib/secret-box.ts). */
  geminiKeyEnc: text("gemini_key_enc"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usernameNormalized: text("username_normalized").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("login_attempts_user_time_idx").on(t.usernameNormalized, t.attemptedAt)],
);

export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    termLang: text("term_lang").notNull(),
    definitionLang: text("definition_lang").notNull().default("en-US"),
    matchBestMs: integer("match_best_ms"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastStudiedAt: timestamp("last_studied_at", { withTimezone: true }),
  },
  (t) => [index("decks_user_id_idx").on(t.userId)],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    term: text("term").notNull(),
    definition: text("definition").notNull(),
    example: text("example").notNull().default(""),
    imageUrl: text("image_url"),
    imageData: bytea("image_data"),
    imageMime: text("image_mime"),
    imageAttribution: text("image_attribution"),
    /** Where the image came from: auto | picked | url | upload (null = legacy, treated as auto). */
    imageSource: text("image_source"),
    /** True when this word doesn't need a picture (decided by AI/heuristics, or the user removed it). */
    noImage: boolean("no_image").notNull().default(false),
    /** Better image-search keyword suggested by AI. */
    imageQuery: text("image_query"),
    /** Topic group suggested by AI (e.g. "Kitchen"), used to introduce related words together. */
    groupLabel: text("group_label"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("cards_deck_position_idx").on(t.deckId, t.position)],
);

export type ModeStats = Record<string, { correct: number; wrong: number }>;

export const cardProgress = pgTable(
  "card_progress",
  {
    cardId: uuid("card_id")
      .primaryKey()
      .references(() => cards.id, { onDelete: "cascade" }),
    stage: integer("stage").notNull().default(0),
    ease: real("ease").notNull().default(2.5),
    intervalDays: real("interval_days").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    correctStreak: integer("correct_streak").notNull().default(0),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    modeStats: jsonb("mode_stats").$type<ModeStats>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("card_progress_due_at_idx").on(t.dueAt)],
);

export const reviewLog = pgTable(
  "review_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    correct: boolean("correct").notNull(),
    answerGiven: text("answer_given").notNull().default(""),
    responseMs: integer("response_ms").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("review_log_user_created_idx").on(t.userId, t.createdAt)],
);

/** Cache of Gemini TTS output (WAV), keyed by sha256(text+lang+voice). */
export const ttsCache = pgTable("tts_cache", {
  key: text("key").primaryKey(),
  audio: bytea("audio").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Cache of native-speaker recordings found on Wiktionary/Wikimedia Commons (url null = none found). */
export const pronunciations = pgTable("pronunciations", {
  key: text("key").primaryKey(),
  url: text("url"),
  attribution: text("attribution"),
  /** Leading article that the recording doesn't include (e.g. "der" for "der Hund"). */
  prefix: text("prefix"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Sliding-window rate limit events (serverless has no shared memory). */
export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucket: text("bucket").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rate_limit_bucket_idx").on(t.bucket, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Deck = typeof decks.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type CardProgress = typeof cardProgress.$inferSelect;
