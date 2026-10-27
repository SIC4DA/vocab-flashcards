CREATE TABLE "sentence_progress" (
	"sentence_id" uuid PRIMARY KEY NOT NULL,
	"stage" integer DEFAULT 0 NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"interval_days" real DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"correct_streak" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"mode_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"day_key" text,
	"day_start_stage" integer DEFAULT 0 NOT NULL,
	"day_wrong" integer DEFAULT 0 NOT NULL,
	"day_correct" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sentences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deck_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"translation" text DEFAULT '' NOT NULL,
	"reply" text,
	"reply_translation" text,
	"card_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sentence_progress" ADD CONSTRAINT "sentence_progress_sentence_id_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."sentences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentences" ADD CONSTRAINT "sentences_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sentences_deck_position_idx" ON "sentences" USING btree ("deck_id","position");