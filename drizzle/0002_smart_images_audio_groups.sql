CREATE TABLE "pronunciations" (
	"key" text PRIMARY KEY NOT NULL,
	"url" text,
	"attribution" text,
	"prefix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "image_source" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "no_image" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "image_query" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "group_label" text;