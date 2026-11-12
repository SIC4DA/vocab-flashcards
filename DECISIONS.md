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
31. **New cards per day** are counted as progress rows created since the user's local midnight (the browser sends its timezone offset). The daily review uses the same local-day logic.
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

## Update: speaking practice removed

68. **Speaking was removed at the owner's request** (it added little and speech recognition was unreliable): the Speak mode, Speak questions in Learn / Review / Test, the microphone UI, the `M` shortcut, the "Enable speaking questions" setting, `/api/transcribe` and the Gemini transcription fallback. Microphone access is now denied via `Permissions-Policy`. Pronunciation (listening) is unchanged.
69. Stage numbers are kept so stored progress stays valid: a word goes from Written (4) straight to Mastered (6). Migration `0003` moves words that were waiting on the old Spoken stage (5) to Mastered (they had already passed every writing step). Older "speak" accuracy statistics are hidden.
70. Mastered-word reviews are now Write 60%, Listen & write 25%, multiple choice 15% (the old weights without speaking, rounded).
71. This supersedes the earlier speaking-related entries above (speech checking, hold-to-talk, microphone fallbacks, Speak in Test).

## Update: Learn redesigned as a daily session

72. **Problem found.** A simulation of the previous Learn (10 new words, 2 correct answers per step, mistakes drop a step, session runs until every word is Mastered) needed **112 questions at 90% accuracy and 299 at 75%**, with one word shown **up to 54 times** in a single sitting. That was the "endless, repetitive" feeling. Not a bug, but the design crammed everything into one session.
73. **Daily session.** Learn now plans a finite session when it starts: due reviews, then words in progress that still have steps left today (current topic first), then up to "new words per day" new words from the current topic. It runs in rounds and ends when every planned word is done for today:
    - review word: one correct answer;
    - learning/new word: climbed `stepsPerDay` steps today (default 2), or reached Mastered;
    - any word: 3 mistakes today (`MAX_WRONG_PER_DAY`), after which it rests until tomorrow.
    Seeing a new word is free. Mistakes don't use up the day's allowance, because progress is measured from the stage the word had at its first answer of the day (`day_start_stage`), and are bounded by the 3-mistake cap. The counters live in `card_progress` (`day_key`, `day_start_stage`, `day_wrong`, `day_correct`) and use the browser's local day.
74. **Defaults.** "Correct answers to move up a step" now defaults to 1 (was 2); migration `0004` moves accounts that still had the old default. Together with 2 steps per day, a new word goes see → MC → listening on day 1, then dictation → writing → Mastered on day 2, then SM-2 reviews. Simulated over 14 days with a 40-word deck: about 27 questions/day at 90% accuracy and 37 at 75% (longest day 61), never more than 6 sightings of one word per day, and all 40 words mastered by day 10 (90%).
75. **"Keep going"** after the session starts a bonus session (+1 step per word, +8 new words — a set), at most 6 times per day.
76. **Topics.** AI topic labels when present (cards without one go to "Other"); otherwise sets of 8 words in deck order (`SET_SIZE`). New words only come from the current topic: the first one that isn't finished. A topic is finished when all its words have been seen and at least 75% are at Written or above (`TOPIC_DONE_SHARE`). Requiring 100% let one or two hard words block new topics for 9 days in the simulation. The deck page shows a Topics/Sets panel with per-topic progress and the current topic; the Learn header shows the current topic; the end screen announces a finished topic and offers to start the next one.
77. Learn's tile is the highlighted, first mode on the deck page ("Your daily session").

## Update: visual redesign ("study desk")

87. Redesigned with the `frontend-design` skill. The previous look was the generic "SaaS card kit": identical rounded cards with one soft shadow, emoji icons, all-caps labels, "·"-joined stats, and an indigo accent. The new identity comes from the subject, a learner's desk: notebook paper with a faint 5 mm grid, index cards (Karteikarten) with a red header line, royal-blue fountain-pen ink for actions, the teacher's red pen for mistakes, a green tick for correct answers, and a highlighter stroke for what's due. The dark theme is a deep ink-blue "night desk", not near-black.
88. Typography: Literata (a reading serif with dictionary-headword character) for words, deck titles and headings; Schibsted Grotesk for the interface. Only the basic Latin files are loaded, which covers German, French, Spanish, Italian, Portuguese and English and keeps pages fast. Other scripts fall back to the Noto fonts as before.
89. The boldness is spent in one place: every study question sits on an index card. Pale-blue ruled lines (`ruled` utility) are used only where text actually sits on them (landing card, deck cards, Learn card), never behind buttons or free-form content. Other screens are flat sheets with hairline rules.
90. Emoji were replaced by line icons (speaker, slow, book, gear, trash, arrows, close) and plain words ("Generate deck", not "✨ Generate deck"). Exceptions: language flags, which carry meaning, and the ← → hints on the Flashcards buttons, which show the keyboard shortcuts.
91. The landing page opens with a real index card you can turn over ("der Hund" → "dog" with an example) and a numbered list of how a word is learned. It's a numbered list because the steps really are a sequence.
92. Recordings from Wikimedia are now loaded anonymously (`crossOrigin = "anonymous"`) so Wikimedia's cookie isn't set in the browser. Wikimedia sends `Access-Control-Allow-Origin: *`, so playback is unchanged.
93. Behaviour is unchanged. Visible text changed in a few places (copy without "·" separators, e.g. "2 of 5 unlocked, 1 mastered"; "Add card" without "＋"), and the related tests were updated. The Gemini key status now updates instantly after saving or removing a key instead of waiting for a page refresh.


## Update: sentences removed, languages trimmed, Articles & plurals, daily review

94. **Sentences were removed** completely (tables, editor, import, Learn integration, mode, Guide). Migration `0006` drops `sentences` and `sentence_progress`. Example sentences on cards (an optional field) stay.
95. **Languages**: one English (`en-US`, shown as "English"), Spanish (`es-ES`), French, German, Italian, one Portuguese (`pt-BR`, shown as "Portuguese") and Arabic. Migration `0006` moves decks from `en-GB`, `es-MX` and `pt-PT` to the kept codes. Decks in other removed languages keep working (voice, recordings) but must pick one of the 7 when the deck's languages are next edited.
96. **Articles & plurals is a separate game**, not part of the Learn ladder: answers update the per-type stats (`article`, `plural`) and the review log only, never the stage or schedule. A word never started in Learn gets a progress row that stays at stage 0 (still New); "new words today" counts only rows past New, and a row's creation time is reset when Learn first shows the word, so the game never uses up Learn's new words for the day. It's offered only for languages whose nouns show gender through the article (`gender` in `lib/languages.ts`).
97. **Data**: `cards.article`, `cards.plural` (without article; `—` = no plural) and `cards.grammar_checked`. Sources, in order, never overwriting what the user typed: the article written in front of the term; the editor's Article/Plural fields; bulk import's `das Buch, die Bücher - book`; on save, `POST /api/decks/:id/grammar` (40 cards per call) — German Wiktionary's noun table (`{{Deutsch Substantiv Übersicht}}`: Genus, Nominativ Plural) for German, then the user's Gemini key for anything still missing in any language. Only single nouns are looked up. Changing a card's term clears an article/plural the user didn't change in the same save and marks it for a new lookup.
98. **Game round**: up to 10 nouns, each with an article question (all of the language's articles as buttons) and a plural question. Plurals are multiple choice (3 distractors generated from the language's usual endings, e.g. Buch → Buche / Buchen / Bucher / Büche) until the learner got that plural right once; after that they're typed. Typed plurals are strict about letters (ä ≠ a, ß ≠ ss) but forgive case and a leading plural article. Wrong answers show both forms (das Buch → die Bücher) and a rule-of-thumb tip for the ending, and come back once at the end. The score counts first tries.
99. **Daily review** replaces "Review all due" (due words still come up in each deck's Learn session). It draws from words at Written or Mastered (stage ≥ 4) across all decks: due words first, then the most-missed (lapses × 2 + wrong answers), then the longest unseen; at most 25 (~10 minutes at ~20 s per answer, not a timer), fewer when fewer are known. Question types: writing 60%, dictation 25%, multiple choice 15%; a missed word comes back once at the end.
100. **The day's word list is fixed** in `daily_reviews` (user, local day, card ids, answered ids, completed_at) when the review is first opened, so a reload continues it. It's complete when every word has been answered once (words deleted since don't block it). "Keep reviewing" adds batches of 10 known words not reviewed today; they don't change completion.
101. **Daily review answers don't distort the schedule**: a due word is reviewed normally (SM-2), a wrong answer drops a Mastered word to Written and brings it back sooner, but a correct answer to a word that isn't due only updates its stats and last-reviewed time. Otherwise reviewing a word early every day would push its interval far out.
102. **Streak** = consecutive local days with a completed daily review, ending today (or yesterday while today's isn't done). Answers in Learn or other modes no longer count. The dashboard shows the streak, the last 7 days as stamps, and today's review (start / continue / done → keep reviewing, or an explanation when no word is known yet).

## Update: simpler deck page and settings, sets only, articles inside Learn

103. **No "Done for today".** Learn's end screen leads with progress: "Set 1 complete!" with one big **Start Set 2** button when a set was just finished (it starts a bonus session that brings in a full set of 8 new words), otherwise "Nice work!" with **Keep going**. The daily step limit is unchanged — spacing is still what makes words stick — it just isn't announced as a stop sign. When nothing is waiting, the screen says so and offers Keep going.
104. **Organize with AI and AI topics were removed** (button, automatic pass on save, endpoint, Gemini prompt). It often failed on save (up to 60 words in one free-tier request with a 10-second limit) and added little: sets of 8 in the learner's own order are predictable and controllable. Existing topic labels in the database are ignored. Pictures are unchanged: the "no picture for verbs and abstract words" heuristic stays, and earlier AI decisions (`no_image`, `image_query`) are kept.
105. **Deck page**: Learn stays the big first tile, followed by the other modes and games; **Edit** stays visible; Duplicate, Export CSV, Reset progress and Delete deck moved into a "⋯" menu (keyboard: arrows, Esc).
106. **Settings only cover sound and looks** (auto-play term/definition, speech rate, sound effects, theme). Native recordings are always used; the cloud voice is only a fallback when the device has no voice (with a key); study pacing (1 correct answer per step, 2 steps/day, 10 new/day, rounds of 7), accents (not strict), articles (counted) and the Test pass mark (80%) are fixed. Stored values of removed settings are ignored, and the API rejects them.
107. **Articles and plurals inside Learn, without extra questions**: the article is shown in a gender colour (masculine blue, feminine red, neuter green; l’ uncoloured) wherever the word is the headword, the stored article is added when the term is just the noun, and the back of the card / the answer feedback show the plural ("das Buch · die Bücher"). Writing a noun from its meaning (Learn, Write, Daily review) expects the article: the right noun with a missing or wrong article is "Almost — the article is part of the word" and counts as wrong (grade 2, no "I was right"). Dictation still checks what was heard. The Articles & plurals game only uses nouns already seen in Learn, so it never asks you to guess something you haven't been shown.
108. **Tips were checked rule by rule** and narrowed so a tip is never wrong for the word it's shown with; each rule has unit tests with words that must match and look-alikes that must not (e.g. -chen → das but not der Kuchen; -um → das but not der Baum/der Irrtum; -ung/-heit/… → die but not das Ei or der Spion; -ma in Spanish/Portuguese is described as split; French -té/-ence name le côté / le silence). German plural tips use the noun's gender (feminine -el/-er add -n; masculine/neuter -el/-er/-en stay the same; der/das/die defaults).
109. **Sound on iPhone Safari**: Safari only starts sound from inside a tap, and every new player must earn that again, so auto-play after looking up a recording was refused (late fallback to the device voice, or silence). Sound now goes through players unlocked by **any tap or key press anywhere on the site** (a Web Audio context for recordings, one shared `<audio>` element for other speeds and the cloud voice, and a silent utterance for the device voice); the listener stays on, so after iOS puts sound to sleep in the background the next tap wakes it. A card already on screen before any tap since coming back can't auto-play (no site can); its speaker button still works. When Learn / a review starts, the recordings of the whole set are looked up and decoded (4 at a time, in question order) and kept in memory only, so cards play instantly; nothing new is stored on the server (the database keeps only the word → recording link, as before). Recordings play at their natural speed through Web Audio unless the speech rate is far from 1× (then the `<audio>` element keeps the pitch). speechSynthesis is only cancelled when something is speaking, and an utterance after cancel() waits 80 ms (iPhone drops it otherwise — the missing "das" in "das Buch"). CSP `connect-src` allows upload.wikimedia.org for this.
110. **Articles are native recordings too**: for "das Buch", the article is looked up on Wiktionary like any word ("das" → De-das.ogg, through the same /api/pronounce cache) and both recordings play back to back through Web Audio, with the silence at their start and end trimmed and an 80 ms pause between them, so it sounds like one phrase (different speakers is acceptable for two short words). Checked on Wiktionary: German der/die/das and French le/la have recordings; Spanish, Italian and Portuguese articles mostly don't, so there the device voice still says the article. Article recordings are preloaded with the set.
