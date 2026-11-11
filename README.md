# Vocab Flashcards

A personal, Quizlet-style vocabulary app. Make decks of words (term, meaning, picture), then learn them with flashcards, multiple choice, listening, writing, a Match game and generated tests. An adaptive **Learn** mode moves every word from recognising it to producing it, and **spaced repetition** brings it back right before you'd forget it.

Pictures and pronunciation are automatic and need no API keys. AI extras are optional: **each user adds their own free Gemini API key** in Settings, so nobody shares a quota.

**👉 Step-by-step deployment guide: [DEPLOY.md](DEPLOY.md)**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYOUR_GITHUB_USER%2Fvocab-flashcards&project-name=vocab-flashcards&repository-name=vocab-flashcards&env=SESSION_SECRET&envDescription=At%20least%2032%20random%20characters%20used%20to%20sign%20login%20sessions.%20Generate%20one%20with%3A%20openssl%20rand%20-base64%2032&envLink=https%3A%2F%2Fgithub.com%2FYOUR_GITHUB_USER%2Fvocab-flashcards%23environment-variables&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D)

> **Before using the button:** push this project to your own GitHub repository and replace `YOUR_GITHUB_USER` in the button link above (twice) with your GitHub username.

---

## Features

- **Accounts** — username + password (no email). Sessions are signed HTTP-only cookies. Brute-force lockout after 10 failed logins in 15 minutes.
- **Decks & cards** — 7 languages — English, Spanish, French, German, Italian, Portuguese and Arabic (with right-to-left support), drag-and-drop or ↑/↓ reordering, undo on delete, Tab-to-add-row, bulk import (tab, comma or ` - `) with live preview, CSV export, duplicate/delete deck.
- **Smart images** — pictures only where they help (objects, food, colours…, not "to spell"). Found on Openverse (Wikimedia Commons as fallback) when you save; with a Gemini key, AI decides per word and picks the search keyword. Pick another, upload your own (resized to 512 px WebP in the browser), paste a URL or remove it. Licence attribution is shown on the card.
- **Sets** — Learn introduces new words 8 at a time, in the order you entered them; finishing a set offers "Start Set 2".
- **Pronunciation** — real native-speaker recordings from Wiktionary/Wikimedia Commons when available (free, no key), otherwise the best-sounding voice on the device; optional Gemini cloud voice with the user's own key. Slow replay.
- **Study modes** — Flashcards (3D flip, swipe), **Learn** (adaptive ladder), Write, Listen (dictation), Match (timed, best time saved), Test (generated exam with pass mark), and **Articles & plurals** (a game for der/die/das and plural forms).
- **Daily review + streak** — a light ~10-minute session across all decks with words you already know, the most-missed first. The streak counts only days on which you finished it; "Keep reviewing" offers more.
- **Articles & plurals** — a separate game per deck (German, French, Spanish, Italian, Portuguese): pick the article, pick then type the plural, with a tip for the pattern after a mistake. Articles and plurals come from the term ("das Buch"), the editor, bulk import (`das Buch, die Bücher - book`), German Wiktionary, or the user's Gemini key.
- **Smart answer checking** — ignores case/spacing/trailing punctuation, accepts `car / automobile` alternatives, “watch the accents”, typo tolerance with an “I was right” override, optional article-ignoring, on-screen special-character bar.
- **Spaced repetition** — simplified SM-2. Progress is saved after every single answer.
- **Stats** — stage bar (New / Learning / Mastered), due today, accuracy by mode, per-card table with reset, daily-review streak with the last 7 days.
- **In-app guide** — a "📖 Guide" page explains the learning ladder (when a word counts as learned), every mode, answer checking, reviews, settings and AI setup.
- **Polish** — light/dark theme, keyboard shortcuts (`?` shows them), sound effects, skeletons, toasts, accessible markup, works on a 360 px phone.

### The learning ladder

| Stage | Name | Question |
|---|---|---|
| 0 | New | Flashcard (view front + back) |
| 1 | Seen | Multiple choice: term → definition |
| 2 | Recognized | Listening multiple choice, then reverse multiple choice |
| 3 | Heard | Listen & write (dictation) |
| 4 | Written | Write the term from the definition + picture |
| 5 | Mastered | Spaced-repetition reviews (Write 60%, Dictation 25%, MC 15%) |

**Learn is a daily session.** It picks today's words (due reviews, words in progress, then up to 10 new words from the current set), asks them in rounds of 7, and ends with your results — or "Set 1 complete!" with a big "Start Set 2" button. One correct answer moves a word up a step, and each word climbs at most 2 steps per day (fixed defaults; Settings only cover sound and looks), so a new word takes about 2 days to master and is then reviewed after 1 day, 6 days, and so on. A mistake moves a word down one step and brings it back 3–5 questions later; after 3 mistakes in a day it rests until tomorrow. Typical session: 5–15 minutes.

**Sets.** New words come one set of 8 at a time, in deck order. The next set starts when 3 of every 4 words in the current one can be written. Earlier sets keep coming back as reviews, so sessions become a mix of everything.

**Articles and plurals in Learn.** Nouns show their article in a gender colour (der blue, die red, das green) and their plural on the back of the card; writing a noun from its meaning needs the article ("das Buch"). Plurals are drilled in the separate Articles & plurals game, which only uses nouns already met in Learn.

## Screenshots

Screenshots of every page and study mode at 390 px and 1280 px are in [`docs/screenshots/`](docs/screenshots/) (e.g. `05-deck-1280.png`, `10-learn-multiple-choice-390.png`, `22-flashcards-dark-390.png`).

## Deploy to Vercel (free Hobby plan)

The full beginner-friendly walkthrough (GitHub → Vercel → database → first login) is in **[DEPLOY.md](DEPLOY.md)**. Short version:

1. Push this repository to GitHub and fix the `YOUR_GITHUB_USER` placeholders in the button link above.
2. Click **Deploy with Vercel**. Vercel will:
   - clone the repo into your account,
   - create a free **Neon Postgres** database through the Marketplace integration (this sets `DATABASE_URL`),
   - ask you for **`SESSION_SECRET`** — paste the output of `openssl rand -base64 32` (or any 32+ random characters).
3. The build runs the database migrations automatically, then the app is live. Open `https://<your-app>.vercel.app/api/health` — it should return `{"ok":true,"db":true}`.
4. Sign up, then (optionally) lock the app — see [Disable sign-ups](#disable-sign-ups).

**If the Neon database wasn't created by the button** (fallback, 3 steps):

1. Vercel dashboard → your project → **Storage** → **Create Database** → **Neon** → create it.
2. **Connect** it to the project (all environments) — this adds `DATABASE_URL`.
3. **Deployments** → latest deployment → **Redeploy**.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | Yes in production (set by the Neon integration) | Postgres connection string. Leave it empty locally to use the built-in embedded database. |
| `SESSION_SECRET` | **Yes** | ≥ 32 random characters used to sign session tokens and encrypt users' saved Gemini keys. The app refuses to start without it. Generate: `openssl rand -base64 32`. Changing it logs everyone out and users must re-enter their Gemini key. |
| `GEMINI_MODEL` | No | Text model. Default `gemini-3.6-flash`. |
| `GEMINI_TTS_MODEL` | No | Text-to-speech model. Default `gemini-3.8-flash-lite-tts`. |
| `ALLOW_SIGNUPS` | No | Default `true`. Set to `false` to close registration. |

See [`.env.example`](.env.example).

### AI features: every user brings their own Gemini key

There is **no app-wide AI key**. Each user can add their own free key in **Settings → ✨ AI features**:

1. Open [Google AI Studio → API keys](https://aistudio.google.com/apikey) and sign in with Google.
2. Click **Create API key** and copy it. New keys start with `AQ.` (since May 2026); older `AIza…` keys also work.
3. In the app: **Settings → AI features** → paste → **Save key**. The app checks it with Google and shows "Connected".

With a key, that user gets: better definition suggestions (plus an example sentence), better picture search for non-English meanings, articles and plurals for French, Spanish, Italian and Portuguese nouns, a cloud voice when their device has no voice for a language, and **✨ Generate deck** from a topic. Usage counts only against their own free quota.

Keys are verified with Google before saving, stored **encrypted** (AES-256-GCM, key derived from `SESSION_SECRET`), used only server-side for that user's own requests, never sent back to the browser and never logged. Calls are rate-limited to 60/minute per user, and any Gemini failure falls back to the free path.

### Disable sign-ups

After creating your own account: Vercel → **Settings** → **Environment Variables** → add `ALLOW_SIGNUPS` = `false` → **Redeploy**. The register page then shows “Sign-ups are closed”.

### Forgotten passwords

There is no email and no password-reset flow by design. A forgotten password can only be recovered by the owner editing the database (e.g. in the Neon console: replace the user's `password_hash` with a new bcrypt hash, or delete the user row).

## Local development

Requirements: Node.js 20.9+.

```bash
npm install
```

```bash
SESSION_SECRET="$(openssl rand -base64 32)" npm run dev
```

Open http://localhost:3000. With no `DATABASE_URL` the app uses **PGlite** (embedded Postgres) stored in `./.pglite/` and migrates it automatically — no setup needed. You can also put `SESSION_SECRET=...` in a `.env.local` file.

To use a Neon database locally, set `DATABASE_URL` and run `npm run db:migrate`.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server (PGlite if `DATABASE_URL` is empty) |
| `npm run build` | Runs DB migrations (when `DATABASE_URL` is set), then `next build` |
| `npm start` | Production server |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run typecheck` | Route type generation + `tsc` |
| `npm test` | Vitest unit + integration tests (in-memory PGlite, no network) |
| `npm run test:e2e` | Production build + Playwright (Chromium, desktop and mobile viewports, all external APIs mocked) |
| `npm run db:generate` | Generate a new migration after editing `lib/db/schema.ts` |

Full check: `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`

## Browser support

The app works in all modern browsers (Chrome, Edge, Safari, Firefox; desktop and mobile).

Native-speaker recordings (Wiktionary) play in every browser. For words without a recording, available voices depend on your operating system. If there is no voice for a language you'll see a one-time notice; install one in your OS speech settings or add your Gemini key in Settings for cloud audio. Browsers only play speech after you've interacted with the page, so the very first auto-play on a freshly opened tab may be skipped — press 🔊 or `P`.

## Keyboard shortcuts

`Space` flip / play · `P` play audio · `Enter` submit / continue · `←` / `→` still learning / know it · `1`–`4` choose an option · `Esc` exit session · `?` list shortcuts

## Tech

Next.js 16 (App Router, TypeScript strict) · Tailwind CSS 4 · Drizzle ORM + Neon serverless Postgres (PGlite locally and in tests) · custom auth with bcryptjs + jose · Zod · Vitest · Playwright. External services (all free, no key): Openverse, Wikimedia Commons, MyMemory.

Project notes: [`DECISIONS.md`](DECISIONS.md) lists every assumption made while building; [`VALIDATION.md`](VALIDATION.md) records the acceptance checks.
