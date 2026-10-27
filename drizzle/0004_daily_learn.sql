ALTER TABLE "card_progress" ADD COLUMN "day_key" text;--> statement-breakpoint
ALTER TABLE "card_progress" ADD COLUMN "day_start_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_progress" ADD COLUMN "day_wrong" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_progress" ADD COLUMN "day_correct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Learn now uses 1 correct answer per step by default (was 2). Accounts still on the old default move to the new one.
UPDATE "users" SET "settings" = jsonb_set("settings", '{advanceAfter}', '1') WHERE "settings"->>'advanceAfter' = '2';
