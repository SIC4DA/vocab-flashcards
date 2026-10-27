-- Speaking practice was removed: words waiting on the "Spoken" stage (5) have already passed
-- every writing step, so they become Mastered (6) and enter spaced-repetition reviews.
UPDATE "card_progress" SET "stage" = 6, "correct_streak" = 0, "reps" = 0, "interval_days" = 1 WHERE "stage" = 5;
