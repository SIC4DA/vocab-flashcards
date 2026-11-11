/** Zod schemas shared by client and server. */
import { z } from "zod";
import { LANGUAGE_CODES } from "./languages";

// No `new Function` JIT: keeps the strict Content-Security-Policy (no unsafe-eval) clean.
z.config({ jitless: true });

export const LIMITS = { decksPerUser: 200, cardsPerDeck: 1000 } as const;
export const CARD_LIMITS = { term: 200, definition: 500, example: 500 } as const;
export const MAX_IMAGE_BYTES = 150 * 1024;

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be at most 20 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers and underscores");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const registerSchema = z.object({ username: usernameSchema, password: passwordSchema });

export const registerFormSchema = registerSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username").max(64),
  password: z.string().min(1, "Enter your password").max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });

const langSchema = z.enum(LANGUAGE_CODES);

export const deckInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100, "Title must be at most 100 characters"),
  description: z.string().trim().max(500, "Description must be at most 500 characters").default(""),
  termLang: langSchema,
  definitionLang: langSchema.default("en-US"),
});

export const deckPatchSchema = deckInputSchema.partial();

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "Image URL must start with https://");

export const cardInputSchema = z.object({
  id: z.string().uuid().optional(),
  term: z.string().trim().min(1, "Term is required").max(CARD_LIMITS.term, `Term must be at most ${CARD_LIMITS.term} characters`),
  definition: z
    .string()
    .trim()
    .min(1, "Definition is required")
    .max(CARD_LIMITS.definition, `Definition must be at most ${CARD_LIMITS.definition} characters`),
  example: z.string().trim().max(CARD_LIMITS.example).default(""),
  imageUrl: httpsUrl.nullable().optional(),
  imageAttribution: z.string().max(1000).nullable().optional(),
  /** Keep the uploaded image stored for this card (false removes it). */
  keepUploadedImage: z.boolean().optional(),
  /** auto | picked | url | upload | none (the user removed the picture). */
  imageSource: z.enum(["auto", "picked", "url", "upload", "none"]).nullable().optional(),
  noImage: z.boolean().optional(),
  article: z.string().trim().max(10).nullable().optional(),
  plural: z.string().trim().max(60).nullable().optional(),
});

export const cardsPutSchema = z.object({
  cards: z.array(cardInputSchema).max(LIMITS.cardsPerDeck, `A deck can have at most ${LIMITS.cardsPerDeck} cards`),
});

export const importSchema = z.object({
  text: z.string().max(200_000),
  delimiter: z.enum(["auto", "tab", "comma", "dash"]).optional(),
  commit: z.boolean().optional(),
});

export const REVIEW_MODES = [
  "learn",
  "review",
  "flashcards",
  "write",
  "listen",
  "match",
  "test",
  "daily",
  "grammar",
] as const;

export const QUESTION_TYPES = [
  "flashcard",
  "mc",
  "mc_reverse",
  "listen_mc",
  "dictation",
  "write",
  "true_false",
  "article",
  "plural",
] as const;

export const reviewSchema = z.object({
  /** Browser timezone offset in minutes (for the daily Learn counters). */
  tz: z.number().int().min(-840).max(840).optional(),
  cardId: z.string().uuid(),
  mode: z.enum(REVIEW_MODES),
  questionType: z.enum(QUESTION_TYPES).optional(),
  correct: z.boolean(),
  grade: z.number().int().min(0).max(5).optional(),
  answerGiven: z.string().max(1000).default(""),
  responseMs: z.number().int().min(0).max(3_600_000).default(0),
  /** Flashcards mode only: "know it" (true) or "still learning" (false). */
  known: z.boolean().optional(),
});

export const translateSchema = z.object({
  text: z.string().trim().min(1).max(500),
  from: langSchema,
  to: langSchema,
});

export const ttsSchema = z.object({ text: z.string().trim().min(1).max(500), lang: z.string().min(2).max(20) });

export const generateDeckSchema = z.object({
  topic: z.string().trim().min(2).max(200),
  termLang: langSchema,
  definitionLang: langSchema,
  count: z.number().int().min(1).max(30),
});

export const generatedCardsSchema = z
  .array(
    z.object({
      term: z.string().trim().min(1).max(CARD_LIMITS.term),
      definition: z.string().trim().min(1).max(CARD_LIMITS.definition),
      example: z.string().trim().max(CARD_LIMITS.example).optional().default(""),
    }),
  )
  .max(30);

export const geminiKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, "That doesn't look like a Gemini API key")
    .max(1000, "That doesn't look like a Gemini API key")
    // Newer AI Studio keys ("auth keys", since May 2026) start with "AQ." and contain dots; older ones start with "AIza".
    .regex(/^[A-Za-z0-9._\-]+$/, "That doesn't look like a Gemini API key — copy it again from Google AI Studio"),
});

export const organizeSchema = z.object({
  cardIds: z.array(z.string().uuid()).max(80).optional(),
  force: z.boolean().optional(),
});

export const organizedCardsSchema = z.array(
  z.object({
    i: z.number().int().min(0),
    image: z.boolean(),
    keyword: z.string().max(80).optional().default(""),
    group: z.string().trim().min(1).max(40),
  }),
);

export const matchResultSchema = z.object({ timeMs: z.number().int().min(1).max(3_600_000) });

/* ----------------------------- settings ----------------------------- */

export const settingsSchema = z.object({
  autoPlayTerm: z.boolean().default(true),
  autoPlayDefinition: z.boolean().default(false),
  speechRate: z.number().min(0.5).max(1.5).default(0.9),
  preferCloudVoice: z.boolean().default(false),
  useRecordings: z.boolean().default(true),
  strictAccents: z.boolean().default(false),
  ignoreArticles: z.boolean().default(false),
  advanceAfter: z.number().int().min(1).max(3).default(1),
  /** How many ladder steps one word may climb per day in Learn (spacing beats cramming). */
  stepsPerDay: z.number().int().min(1).max(5).default(2),
  newPerDay: z.number().int().min(1).max(100).default(10),
  roundSize: z.number().int().min(5).max(15).default(7),
  passMark: z.number().int().min(50).max(100).default(80),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  soundEffects: z.boolean().default(true),
});

export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = settingsSchema.partial();

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** Merge stored (possibly stale/partial) settings with defaults, dropping invalid values. */
export function resolveSettings(stored: unknown): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  if (stored && typeof stored === "object") {
    for (const [k, v] of Object.entries(stored)) {
      const field = settingsSchema.shape[k as keyof Settings];
      if (field && field.safeParse(v).success) out[k] = v;
    }
  }
  return out as Settings;
}

export type FieldErrors = Record<string, string>;

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
