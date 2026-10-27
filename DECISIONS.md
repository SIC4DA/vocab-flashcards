# Decisions and assumptions

Everything below was either unspecified in the requirements or needed an interpretation. In each case the simplest option that still works was chosen.

## Platform and framework

1. **Versions checked at build time (Oct 2026):** Next.js 16.4, React 19.3, Drizzle ORM 0.45 / drizzle-kit 0.31, `@neondatabase/serverless` 1.2, PGlite 0.5, Zod 4, Tailwind 4, Vitest 5, Playwright 1.64.
2. `proxy.ts`**, not** `middleware.ts`**.** Next.js 16 renamed Middleware to Proxy; Proxy always runs on the Node.js runtime, which also suits `jose`.
3. **Cache Components disabled.** The scaffold enabled `cacheComponents`; it was removed because it forbids the `runtime` route-segment export the spec requires on every route and adds caching semantics this app doesn't need. All pages are dynamic (they read the session cookie).
4. **Every route handler exports** `runtime = "nodejs"` (it's also the default).
5. `/` **is public**: logged-out visitors see a landing page, logged-in users see the dashboard (the spec lists `/` both as the dashboard and as a public route).
6. **Pages are thin server components** that check ownership (so foreign deck URLs return a real HTTP 404 via `notFound()`), and render client components that call the JSON API. The only `loading.tsx` is on the dashboard route group: a root-level one would stream every page, which turns `notFound()` into an HTTP 200.

## Data model

7. **Extra tables:** `tts_cache` (Gemini WAV cache, keyed by `sha256(text+lang+voice)`) and `rate_limit_events` (DB-backed per-user rate limiting, since serverless instances share no memory).
8. **Extra columns:** `cards.image_mime` (content type of the uploaded image) and `decks.match_best_ms` (best Match time per deck).
9. `card_progress.card_id` is the **primary key** (which makes it unique, as required). A card with no progress row is stage 0 / New.
10. Bytea is mapped with a Drizzle `customType`.

## Auth and security

11. **Lockout** counts failed attempts per normalized username in the last 15 minutes (independent of IP). A success doesn't reset the window; the lock simply expires.
12. **Timing:** unknown usernames are still compared against a dummy bcrypt hash. bcrypt cost = 11.
13. **Session refresh** happens in `proxy.ts`: when more than 15 of the 30 days have elapsed, a fresh cookie is set on the response.
14. **CSRF:** for POST/PUT/PATCH/DELETE under `/api`, the `Origin` header (when present) must match the host, `Sec-Fetch-Site: cross-site` is rejected, and bodies must be `application/json` or `multipart/form-data`.
15. **CSP** uses `script-src 'self' 'unsafe-inline'` because Next.js injects inline bootstrap scripts; nonces would force per-request rendering of everything and add complexity. `unsafe-eval` is not allowed in production; Zod's JIT is turned off (`z.config({ jitless: true })`) so it never probes `new Function`.
16. `Permissions-Policy` allows the microphone and camera for the app's own origin only (speech practice and photo upload).
17. `ALLOW_SIGNUPS=false`: the register page shows "Sign-ups are closed" and the API returns 403.
18. Auth API routes (`/api/auth/*`, `/api/health`, `/api/config`) are public; every other API route returns 401 JSON without a session; every page except `/`, `/login`, `/register` redirects to `/login?next=…`. Logged-in users visiting `/login` or `/register` are sent to `/`.

## Images

19. **Images are found after saving, from the browser**: once the deck is saved, the editor calls a new endpoint `POST /api/cards/:id/auto-image` for each card without an image (3 in parallel) and shows "Finding images… n/N". Doing it inside the save request could exceed the 10 s function limit for big decks. Failures never block saving.
20. `auto-image`, `images/search`, `translate`, `tts`, `transcribe` and `generate-deck` set `maxDuration = 25` (Openverse 8 s timeout + Wikimedia 8 s fallback can exceed 10 s). This is within Hobby limits.
21. The stored URL is the provider **thumbnail** (Openverse `thumbnail`, Wikimedia 400 px `thumburl`). Wikimedia search adds `filetype:bitmap` to skip SVG/PDF/audio files.
22. "Roughly landscape or square" = width/height ≥ 0.8; "≥ 200 px" = shorter side ≥ 200 when sizes are known.
23. Upload compression tries WebP at quality 0.8, then 0.7 and 0.6, before rejecting at > 150 KB. Browsers that can't encode WebP fall back to JPEG. The server accepts WebP/JPEG/PNG verified by magic bytes.
24. Pasted image URLs must be `https://`.

## Learning logic

25. **Stage 2** alternates: listening multiple choice first, then reverse multiple choice (streak 0 → listening, 1 → reverse).
26. **Light SRS schedule for cards still on the ladder (stages 1–5):** ease is updated with the SM-2 formula, a correct answer makes the card due in 1 day, a wrong one makes it due immediately; `reps` only counts mastered reviews. On graduating to stage 6, SM-2 starts fresh (1 day, then 6 days, then interval × ease). Otherwise a card answered 10 times in one Learn session would jump to a months-long interval.
27. **Who moves the ladder:** Learn and Review use the ladder. Write, Listen, Speak and Test update scheduling and per-mode stats only (a correct answer still moves a New card to stage 1, and a wrong answer on a mastered card still drops it to stage 4 as SM-2 requires).
28. **Flashcards mode:** "Know it" = grade-4 review (stage 0 → 1 only). "Still learning" marks a New card as seen (stage 1) without an SRS penalty. Still-learning cards are repeated through the end-of-round button "Study the N still-learning cards" rather than being appended automatically, so a round always ends.
29. **Learn sessions:** each round asks one question per selected card; wrong cards are re-inserted 3–5 positions later, or at the end of the round if fewer positions remain. The session ends when no candidates remain (no due cards, no cards in progress, and the daily new-card allowance is used up).
30. **"Due today"** = stage ≥ 1 and `due_at ≤ now`.
31. **New cards per day** are counted as progress rows created since the user's local midnight (the browser sends its timezone offset). The streak uses the same local-day logic.
32. **Review question types** for mastered cards use the 40/30/20/10 weights; unavailable types (Speak without recognition, MC in decks with ≤ 2 cards) have their weight redistributed.
33. **"Almost right" (typo) answers** are recorded when the learner presses Continue or "I was right", so exactly one review is saved per answer. Every other answer is saved immediately.

## Answer checking

34. Trailing punctuation (and leading `¿`, `¡`, quotes) is always ignored; leading articles only when "Ignore articles" is on (articles per language in `lib/languages.ts`).
35. The typo distance is computed on accent-stripped strings, so an accent slip and a one-letter typo don't add up.
36. With **Strict accents** on, an accent-only mismatch is shown as "Almost — watch the accents" and counts as incorrect.
37. Speech matching also accepts `/` or `;` alternatives in the term and strips all punctuation and symbols.

## Audio and speech

38. **Auto-play only after the user has interacted with the page** (`navigator.userActivation.hasBeenActive`). Chrome deprecates `speechSynthesis.speak()` without a user gesture. Normal navigation (clicking into a study mode) counts as interaction, so auto-play works in practice.
39. Gemini TTS uses the prebuilt voice "Kore" and is requested with the text prefixed by "Say clearly in :".
40. Speak UI: on touch screens the mic is hold-to-talk; with a mouse or keyboard it's click (or `M`) to start/stop.
41. If the microphone is denied or recognition is unsupported mid-session, all remaining Speak questions in that session become Write questions and a notice explains why.
42. In **Test**, Speak questions record speech with the mic; if the mic is unavailable they become typed answers.

## Gemini

43. Default models (checked against the Gemini changelog, Oct 2026): text `gemini-3.6-flash`, TTS `gemini-3.8-flash-lite-tts` (the 2.5/3.1 preview TTS models are being retired). Both are overridable.
44. Calls use the REST API directly (no SDK): `x-goog-api-key` header, 10 s timeout, one retry on 429/5xx, JSON mode for structured output. Rate limit: 60 Gemini calls per user per minute (DB-backed). TTS cache hits don't count.
45. "Generate deck" fills the editor; nothing is saved until the user reviews and presses Save.

## UI

46. Header is hidden on phones during study sessions to give more room for one-hand use; the ✕ button (or `Esc`) exits.
47. A "Sound effects" toggle was added to settings (the spec says sounds "can be turned off").
48. Fonts: system font stack first, then Noto Sans (Latin/Cyrillic/Greek/Vietnamese), Noto Sans Arabic and Noto Sans Hebrew via `next/font` (loaded on demand via `unicode-range`). CJK, Thai and Devanagari use system fonts, which every modern OS ships, to avoid very large font downloads.
49. Unsaved-changes protection uses `beforeunload` plus a confirmation on in-app link clicks (the App Router has no route-change events).
50. Card deletes in the editor take effect on Save (undo is available from the toast until then).
51. Test question count ranges from `min(5, cards)` to the number of cards.
52. CSV export adds a UTF-8 BOM (for Excel) and prefixes cells starting with `= + - @` with `'` to prevent formula injection.

## Local development and testing

53. Without `DATABASE_URL`, PGlite persists to `./.pglite/` (or memory when `PGLITE_DIR=memory://`) and migrates on first use. `npm run build` skips migrations when `DATABASE_URL` is empty.
54. **E2E mocking:** Playwright route interception only sees browser requests, but Openverse, Wikimedia, MyMemory and Gemini are called from the server. The E2E suite therefore starts a small local mock server (`tests/e2e/mock-server.mjs`), and the app points at it through test-only base-URL variables (`OPENVERSE_API_URL`, `WIKIMEDIA_API_URL`, `MYMEMORY_API_URL`, `GEMINI_API_URL`). Image downloads made by the browser (`https://images.e2e.test/...`) are intercepted with `page.route`. `speechSynthesis` and `SpeechRecognition` are replaced by an injected script.
55. E2E runs against the production build with two servers: port 3100 without Gemini and port 3101 with a mocked Gemini key, so both "Gemini UI hidden" and "Generate deck works" are tested.
56. Integration tests call route handlers directly with `NextRequest` objects against an in-memory PGlite database, so no server or network is needed.`
57. The Neon connection uses a small WebSocket pool (`max: 5`, 10 s idle timeout) with an error handler, so dropped idle connections can't crash a serverless instance.

## Update: better sound, smart pictures, topics, new key format

58. **Gemini key format.** Since 28 May 2026 AI Studio creates "auth keys" that start with `AQ.` and contain dots; the old validator only allowed `[A-Za-z0-9_-]`. Keys now allow `.` (up to 1,000 characters). They're sent the same way (`x-goog-api-key`). Keys are checked with a free `countTokens` call on the configured model (falling back to listing models if that model name is unknown), which proves the key may actually call the Gemini API; Google's error message is shown when a key is rejected.
59. **Pronunciation sources.** Gemini TTS can't be the main fix for bad device voices: its free quota is very small (developers report around 10 requests per day on the free tier, 100/day on paid Tier 1). Instead, the app first looks for a **native-speaker recording on Wiktionary / Wikimedia Commons** (free, no key, human voices). Lookup order: the term language's Wiktionary, then English Wiktionary; file names are matched strictly (`De-Hund.ogg`, `De-Hund2.ogg`, regional `De-at-Hund.ogg`, Lingua Libre `LL-Q188 (deu)-Speaker-Hund.wav`) so recordings of other words or languages aren't used. The MP3 transcode is played (works in every browser, Safari included). Results, including "none found", are cached in the new `pronunciations` table (misses for 14 days); failed lookups aren't cached. Terms over 4 words or 60 characters skip the lookup.
60. **Articles.** Wiktionary files usually have the bare noun ("Hund"). For "der Hund" the article is spoken with the device voice, then the recording plays, so dictation still includes the article.
61. Then Gemini cloud voice (the user's key) when they prefer it or the device has no voice; after a cloud failure (e.g. quota exhausted), the cloud voice is skipped for 10 minutes so playback isn't delayed. Then the device voice, now picked by quality (natural/neural/online, enhanced/premium, Google voices first; novelty voices last).
62. A "Use native-speaker recordings" setting (default on) turns recordings off. The next word's recording is prefetched during study sessions.
63. **Smart pictures.** New card columns: `image_source` (auto / picked / url / upload / none), `no_image`, `image_query`, `group_label`. With a key, one Gemini request per batch of ≤ 60–80 cards decides `image` (does a photo help?), a search `keyword` and a topic `group` ("organize"). It runs on save for cards without a topic, and from the deck page's **✨ Organize with AI** button (all cards, for older decks). Organize only changes pictures it chose itself (`auto`, or legacy `null`): pictures the user picked, pasted or uploaded, or removed (`none`), are never touched.
64. Without a key, a conservative rule skips pictures for English definitions starting with "to …" (verbs). The user can always add a picture by hand. Removing a picture marks the word "no picture needed" so it isn't re-added on the next save (this fixes the earlier behaviour, where a removed picture came back).
65. Editing a card's term or definition clears its topic and image keyword so the next save re-organizes it.
66. Study screens show no image box for words without a picture; the first-letter placeholder is now only used when an image fails to load.
67. **Topics in Learn.** Due cards and cards in progress still come first (spaced repetition must not be overridden). Only the choice of *new* words uses topics: the topic most present among words in progress continues first (if it still has new words), otherwise the next topic in deck order. Cards in progress of the same topic are asked together. Without topics, new words come in deck order (they were never random). Gemini is asked to group by theme or situation rather than near-synonyms, since learning many look-alike words at once tends to cause mix-ups.

