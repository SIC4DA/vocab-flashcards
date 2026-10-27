# Validation

Results of the acceptance criteria in §14 of the requirements. Run on macOS, Node.js 24.12, 27 Oct 2026.

## 14.1 Automated tests

Command: `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` → **exit code 0**.

| Step | Result |
|---|---|
| `npm run lint` | ✅ 0 errors, 0 warnings (`--max-warnings=0`) |
| `npm run typecheck` | ✅ `next typegen && tsc --noEmit`, strict mode, no errors |
| `npm test` (Vitest) | ✅ **136 tests in 13 files** passed (unit + integration on in-memory PGlite, no network) |
| `npm run test:e2e` (Playwright) | ✅ **36 tests** passed (18 scenarios × desktop 1280 px and mobile Pixel 7 viewports, Chromium, production build) |
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
- ✅ Review endpoint updates `card_progress` (stage, lapses, mode stats) and writes `review_log`; due count and streak update.
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

| 12 | Native recording plays for “der Hund” (article via device voice, then the Wikimedia recording); sentences fall back to the device voice; English verbs get no picture without AI; with an `AQ.` key, **Organize with AI** sets topics and removes the automatic picture from “to reflect”, and study screens show no empty image box | ✅ |

### Update checks (better sound, smart pictures, topics, new key format)

- Live Wiktionary lookups via `/api/pronounce` (dev server, real network): recordings found for *der Hund*, *die Wurst*, *das Handtuch*, *buchstabieren*, *sprechen*, *guten Morgen* (German), *la manzana*, *el perro* (Spanish, Lingua Libre) and *apple* (en-US); *Ich habe Hunger* correctly returned none.
- In the in-app browser, pressing 🔊 for *der Hund* played `De-Hund.ogg.mp3` from upload.wikimedia.org under the production CSP.
- `AQ.`-format keys: accepted by validation, verified via `countTokens`, used for requests (unit + integration + E2E with a mocked Google).
- Not verified: a real `AQ.` key against Google (none available), and Gemini's real decisions about which words need pictures and how it groups them (tested with mocked responses).

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
