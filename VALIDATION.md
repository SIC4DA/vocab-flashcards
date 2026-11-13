# Validation

Results of the acceptance criteria in §14 of the requirements. Run on macOS, Node.js 24.12, 27 Oct 2026.

## 14.1 Automated tests

Command: `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` → **exit code 0**.

| Step | Result |
|---|---|
| `npm run lint` | ✅ 0 errors, 0 warnings (`--max-warnings=0`) |
| `npm run typecheck` | ✅ `next typegen && tsc --noEmit`, strict mode, no errors |
| `npm test` (Vitest) | ✅ **155 tests in 14 files** passed (unit + integration on in-memory PGlite, no network) |
| `npm run test:e2e` (Playwright) | ✅ **40 tests** passed (20 scenarios × desktop 1280 px and mobile Pixel 7 viewports, Chromium, production build) |
| `npm run build` | ✅ migrations step (skipped without `DATABASE_URL`) + `next build`, no warnings |

### Unit tests (`tests/unit`)

| Area | File | Covers |
|---|---|---|
| SM-2 | `srs.test.ts` | grade mapping, 1 → 6 → interval × ease progression, ease formula, ease floor 1.3, lapses, light learning schedule, due-date math |
| Ladder | `learn.test.ts` | stage up after N correct (N = 1, 2, 3), down on wrong (min 1), mastered lapse → 4, stage 0 → 1 on view, Speak skipped when unavailable (4 → 6), question type per stage, review-type weights, distractors (no duplicates, answer exactly once, small decks, similarity preference), round selection order, re-insertion 3–5 later, test generation |
| Answer checker | `answer-check.test.ts` | case, whitespace, NFC, trailing punctuation, accent leniency vs strict, typo thresholds (< 5, ≥ 5, ≥ 10), `/` and `;` alternatives, articles option (es/de/fr), empty input, diff highlighting |
| Speech match | `speech-match.test.ts` | alternatives list, 0.8 similarity threshold, punctuation, multi-word phrases, empty input |
| Import parser | `import-parser.test.ts` | tab / comma / " - " delimiters, first-delimiter split, blank lines, malformed lines reported with line numbers, explicit delimiter, length limit |
| Zod schemas | `validation.test.ts` | username rules, password length, confirm match, deck/card field limits, 1,000-card limit, https-only image URLs, settings defaults, upload magic bytes |
| Misc | `misc.test.ts` | streak + timezone, image picking rules, PCM → WAV, languages/RTL, Levenshtein |

### Integration tests (`tests/integration`, Vitest + PGlite)

- ✅ Register → duplicate username with different case rejected (409, field error).
- ✅ Login lockout after 10 failures (429), other usernames unaffected.
- ✅ Ownership isolation: user B gets **404** on all 15 deck/card endpoints for user A's deck and card; A's data unchanged.
- ✅ Card upsert creates + updates + deletes + reorders in one call; invalid input rolls back; foreign card ids can't be hijacked.
- ✅ Review endpoint updates `card_progress` (stage, lapses, mode stats) and writes `review_log`; due count updates; the streak only counts finished daily reviews.
- ✅ Account deletion requires the password and cascades (users, decks, cards, progress, review log).
- Also: session cookie flags and 30-day JWT, logout, password change, settings validation, `ALLOW_SIGNUPS=false`, import preview/commit, CSV export, duplicate, upload magic-byte / size checks, ETag 304, queue building with distractors, reset progress, best Match time, 1,000-card limit, health/config, Openverse → Wikimedia fallback, image lookup never failing, MyMemory vs Gemini translation with fallback, Gemini-only routes 404 without key, TTS WAV + cache, generate-deck JSON validation.

### End-to-end (`tests/e2e`, Playwright)

External HTTP APIs are mocked by a local mock server (server-side calls) and `page.route` (browser image requests); `speechSynthesis` and `SpeechRecognition` are mocked by an injected script (see DECISIONS.md #54).

| # | Scenario | Result |
|---|---|---|
| 1 | Register, log out, (wrong password message), log back in, deck still there; duplicate username in different case rejected | ✅ |
| 2 | Create a Spanish→English deck with 6 cards via the editor (Tab adds a row, auto-fill definition), images filled from mocked Openverse, bulk-import 4 more (with a malformed line in the preview) → 10 cards | ✅ |
| 3 | Flashcards: play audio (asserts `speechSynthesis.speak` called with `lang` `es-ES`), flip, know / still learning (keyboard on desktop, buttons on mobile), finish round, study still-learning | ✅ |
| 4 | Learn: one card goes flashcard → MC → listening → dictation → write → speak → **Mastered**; a wrong answer brings the card back 3–5 questions later | ✅ |
| 5 | Write: `el cafe` for `el café` counts (watch the accents), `la manzena` → "Almost right" → "I was right" override; special-character bar | ✅ |
| 6 | Speak: right word passes, wrong word fails (shows what was heard), permission denied → notice + Write; "Skip" turns the question into Write | ✅ |
| 7 | Match: wrong pair flashes, game completes, best time shown and saved | ✅ |
| 8 | Test with all five question types, results with score and **Failed** at 80% pass mark, "Retake with missed only" → **Passed** 100% | ✅ |
| 9 | Edit: reorder, delete with undo, upload a PNG fixture (resized to ≤ 512 px WebP in the browser), save, reload — persisted; unsaved-changes warning | ✅ |
| 10 | User B opening user A's deck, edit and study URLs → HTTP **404** page; API 404 | ✅ |
| 11 | Per-user Gemini key: without a key the AI UI is hidden; a wrong key is rejected; a valid key (mocked Google) connects, "Generate deck" and Gemini auto-fill work; removing it turns AI off; another user isn't affected. In-app guide explains when a word is learned (personalised numbers) | ✅ |

| 12 | Native recording plays for “der Hund” (article via device voice, then the Wikimedia recording); phrases fall back to the device voice; English verbs get no picture without AI; with an `AQ.` key, **Organize with AI** sets topics and removes the automatic picture from “to reflect”, and study screens show no empty image box | ✅ |

### Update checks (better sound, smart pictures, topics, new key format)

- Live Wiktionary lookups via `/api/pronounce` (dev server, real network): recordings found for *der Hund*, *die Wurst*, *das Handtuch*, *buchstabieren*, *sprechen*, *guten Morgen* (German), *la manzana*, *el perro* (Spanish, Lingua Libre) and *apple* (en-US); *Ich habe Hunger* correctly returned none.
- In the in-app browser, pressing 🔊 for *der Hund* played `De-Hund.ogg.mp3` from upload.wikimedia.org under the production CSP.
- `AQ.`-format keys: accepted by validation, verified via `countTokens`, used for requests (unit + integration + E2E with a mocked Google).
- Not verified: a real `AQ.` key against Google (none available), and Gemini's real decisions about which words need pictures and how it groups them (tested with mocked responses).

### Update: speaking removed

Speaking practice was removed at the owner's request (see DECISIONS.md #68–71), so the original §14 items about Speak mode, speech matching and the microphone no longer apply; their tests were removed. A new E2E test checks that the Speak mode tile is gone, `/decks/:id/study/speak` returns 404, and Settings has no speaking options. The Learn E2E test now checks the order flashcard → MC → listening → dictation → write → Mastered.

### Update: Learn algorithm validated and redesigned

- **Simulation of the old Learn** (10 new words, default settings): 112 questions in one session at 90% accuracy, 299 at 75%, one word asked up to 54 times. This confirmed the "endless" report.
- **Simulation of the new daily Learn** (40-word deck, 14 days): 27 questions/day on average at 90% accuracy (longest day 43), 37 at 75% (longest 61); at most 6 times per word per day; a new topic about every 2 days; all words mastered by day 10 at 90% accuracy.
- Unit tests cover session planning order, daily step limits, the free first view, mistakes not consuming steps, the 3-mistake cap, reviews done after one correct answer, words excluded once their day is done, topics (AI labels, sets of 8, 75% rule, summary), and an "it never becomes endless" regression bound (≤ 60 questions, ≤ 6 per word for 10 new words at 75%).
- E2E: with default settings, a 4-word deck takes exactly 12 questions (each word: see → multiple choice → listening), ends with "Done for today!", shows the stats, and "Keep going anyway" continues with dictation; the deck page shows the set as "Learning now". The full-ladder test (5 steps/day) still follows one word to Mastered and checks wrong answers return 3–5 questions later.

### Update: redesign

- Full chain passes: lint, typecheck, 155 unit/integration tests, 42 E2E tests (desktop + mobile), build.
- Lighthouse (mobile, production build) after the redesign: landing 100 / 100 / 100; dashboard 94 / 100 / 100; deck 94 / 100 / 100; flashcards 93 / 100 / 100; Learn 93 / 100 / 96. The one Learn issue is a console 404 for the mock recording URL used in this test setup, which doesn't exist on the real Wikimedia server.
- Screenshots of every page at 390 px and 1280 px, in light and dark mode, were reviewed and refreshed in `docs/screenshots/`.

### Update: simpler deck page and settings, sets only, articles inside Learn

- Full chain passes: lint, typecheck, 157 unit/integration tests, 44 E2E tests (desktop + mobile), build.
- Unit tests: every grammar tip against words that fit and look-alikes that must not get it (German, Spanish, French, Italian, Portuguese; plural tips by gender); noun forms (stored article added, plural with its article, gender colours); writing a noun needs its article (missing or wrong article → "article", typos still "typo"); sets of 8 replace AI topics; stored values of removed settings are ignored.
- Integration: the settings API accepts only sound/look settings and rejects the fixed ones.
- E2E: Learn ends with "Nice work!" and never "done for today"; the full ladder is reached through "Keep going" with fixed defaults; the deck page has no Organize button and its ⋯ menu holds Duplicate / Export CSV / Reset progress / Delete deck; Articles & plurals waits until nouns are met in Learn, flashcards show "der" in the masculine colour and "der Hund · die Hunde" on the back, and Write mode marks "Hund" as missing its article.

### Update: daily review, Articles & plurals, sentences removed

- Full chain passes: lint, typecheck, 155 unit/integration tests, 44 E2E tests (desktop + mobile), build.
- Unit tests (`grammar-daily.test.ts`): splitting articles (incl. French l’), `das Buch, die Bücher` import lines, strict plural checking (Bucher ≠ Bücher, Strasse ≠ Straße), umlauts, 4 unique plural options, full forms, tips, round building (article + plural, typing once known, non-nouns skipped); daily plan order (due → most missed → longest unseen, known words only, exclusions), daily answers (not-due right answer leaves the schedule alone; wrong drops to Written; due reviewed normally), the 7-day strip.
- Integration tests (`grammar-daily.test.ts`): the daily review list is fixed and continues after a reload, completes after every word is answered, counts towards the streak (and only it — a Learn answer doesn't); no review without known words; deleted words don't block completion. Grammar lookup from (mocked) German Wiktionary without overwriting typed values, phrases skipped, nothing re-checked, term changes trigger a new lookup; Spanish uses the term's article without a key and Gemini with one; import splits plurals; game answers are stats-only (a New word stays New and Learn's new-words-per-day isn't affected).
- E2E (desktop + mobile): daily review from the dashboard with a miss coming back once at the end, "1 day streak" and a stamp, "Keep reviewing", dashboard updates. Articles & plurals: lookup from the game's empty state, a round with a wrong article (tip about -ung, full forms, retried at the end, 5/6 score), then a second round where plurals are typed and "Bucher" is wrong; the deck page and editor show the found plural and article.

## 14.2 Manual checklist

### Build
✅ `npm run build` succeeds with no TypeScript or ESLint errors and no warnings in the build output.

### Fresh install with only `SESSION_SECRET`
✅ Copied the project without `node_modules`, `.next` and `.pglite` to an empty folder, ran `npm i` then `npm run dev` with an environment containing only `PATH`, `HOME` and `SESSION_SECRET`:
- `/api/health` → `{"ok":true,"db":true}` (PGlite created in `.pglite/` and migrated automatically)
- register via the API → 201, landing page → 200.

Also verified: starting without `SESSION_SECRET` fails with *"SESSION_SECRET is missing or shorter than 32 characters…"* from the instrumentation hook, and every request returns 500 — the app never runs with a default secret.

### Lighthouse (mobile, Lighthouse 13.5, production build, logged-in)

| Page | Performance | Accessibility | Best Practices |
|---|---|---|---|
| Dashboard `/` | 98 | 100 | 100 |
| Learn `/decks/:id/study/learn` | 96 | 100 | 100 |
| Flashcards `/decks/:id/study/flashcards` | 96 | 100 | 100 |

Targets: ≥ 85 / ≥ 95 / ≥ 95 — all met. Issues found and fixed during this check: the hidden face of the flip card used `aria-hidden` over focusable buttons (now `inert`), auto-played speech before any user gesture (now gated on user activation), and Zod's JIT probe tripped the CSP (now `jitless`).

### Console errors during the E2E flow
✅ Every E2E test fails if the page logs a console error or throws. The only allowed messages are the browser's own network log lines for responses the tests provoke on purpose: the 401 of a wrong-password login, the 409 of a duplicate username, and the 404 pages in the isolation test.

### Real-browser smoke test (Chromium, no mocks)
✅ `npx playwright test -c playwright.screenshots.config.ts` (Chromium, no speech mocks):
- TTS: **180 voices** loaded, Spanish voice "Eddy (Spanish (Spain))" selected, utterance **started** playing (`docs/screenshots/tts-smoke.json`).
- Screenshots of every page and study mode (landing, register, dashboard empty/full, deck, editor, flashcards front/back, learn new card / multiple choice / feedback, write, listen, speak, match, test options / questions / results, review, settings, dark mode) at **390 px** and **1280 px**: `docs/screenshots/*-390.png`, `*-1280.png` (44 images).

## Not verified locally

- **Neon / Vercel deployment.** No Neon credentials were available here, so the Neon driver path (`DATABASE_URL` set), `scripts/migrate.ts` against Neon, and the Deploy Button's `stores` parameter (integration slug `neon`, product slug `neon`) were not exercised end to end. The Neon code path typechecks and uses Drizzle's official `neon-serverless` driver and migrator; the README includes the 3-step manual fallback for attaching the database.
- **Live third-party APIs** were only checked by hand during development (Wikimedia and MyMemory answered; Openverse timed out at that moment, and the app correctly fell back to Wikimedia). Automated tests mock them, as required.
- **Real Gemini calls** — tested only against mocks (no key available).
- **Real microphones / mobile Safari** — speech recognition was tested with mocks; Safari wasn't available.

## Dependency audit

`npm audit` reports 4 moderate advisories, all in `drizzle-kit`'s bundled `esbuild` dev server (GHSA-67mh-4wv8-2f99). `drizzle-kit` is a dev-only tool used to generate migrations; it isn't part of the deployed app, and the suggested "fix" downgrades drizzle-kit to an incompatible major version, so it was left as is.

## iPhone sound (unlock on tap, set preloading)
- E2E: recordings play through the new path, the silent unlock clip/utterance is never counted as speech, no audio replays after answering.
- Not verified on a real iPhone or the iOS Simulator (Xcode is not installed on the build machine): check on device.
- Full chain passes: lint, typecheck, 157 unit/integration tests, 44 E2E tests (desktop + mobile), build.

## Native article recordings
- E2E: "der Hund" plays the recording of "der" and then "Hund" (no device voice); "das Buch" with no "das" recording falls back to the device voice for the article, then the recording. Confirmed the back-to-back Web Audio path is what played.
- Full chain passes: lint, typecheck, 157 unit/integration tests, 44 E2E tests (desktop + mobile), build.

## Auto-play delay
- `AUTO_PLAY_DELAY_MS = 400`; E2E auto-play checks still pass. E2E now serves an empty Vercel Analytics script (it only exists on Vercel).
- Full chain passes: lint, typecheck, 157 unit/integration tests, 44 E2E tests (desktop + mobile), build.
