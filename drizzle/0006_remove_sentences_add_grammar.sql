DROP TABLE "sentence_progress" CASCADE;--> statement-breakpoint
DROP TABLE "sentences" CASCADE;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "article" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "plural" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "grammar_checked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "decks" SET "term_lang" = 'en-US' WHERE "term_lang" = 'en-GB';--> statement-breakpoint
UPDATE "decks" SET "term_lang" = 'es-ES' WHERE "term_lang" = 'es-MX';--> statement-breakpoint
UPDATE "decks" SET "term_lang" = 'pt-BR' WHERE "term_lang" = 'pt-PT';--> statement-breakpoint
UPDATE "decks" SET "definition_lang" = 'en-US' WHERE "definition_lang" = 'en-GB';--> statement-breakpoint
UPDATE "decks" SET "definition_lang" = 'es-ES' WHERE "definition_lang" = 'es-MX';--> statement-breakpoint
UPDATE "decks" SET "definition_lang" = 'pt-BR' WHERE "definition_lang" = 'pt-PT';
