# Deploy guide: from your computer to a live website

This takes about **15–20 minutes** and costs nothing. You'll end up with a site like `https://vocab-flashcards-yourname.vercel.app` that works on your phone and computer.

What you'll use (all free):

- **GitHub**: stores your code.
- **Vercel** (Hobby plan): runs the website. Every time you push code to GitHub, Vercel redeploys automatically.
- **Neon**: the Postgres database. You create it from inside Vercel in two clicks.
- **Google AI Studio** (optional, per user): each user creates their own free Gemini key and pastes it into the app's Settings. You don't need one to deploy.

---

## Part 1: Put the code on GitHub

### 1.1 Create an empty repository

1. Go to <https://github.com> and log in (or sign up).
2. Click **+** (top right) → **New repository**.
3. **Repository name:** `vocab-flashcards`.
4. Choose **Private** (recommended) or Public. Vercel works with both.
5. **Don't** tick "Add a README", ".gitignore" or "license". The repository must be empty.
6. Click **Create repository**. Keep the page open; it shows your repository URL, e.g. `https://github.com/YOUR_USERNAME/vocab-flashcards.git`.

### 1.2 Push the code

Open **Terminal**, then run these commands one at a time. Replace `YOUR_USERNAME` with your GitHub username.

```bash
cd ~/Documents/Claude/vocab-flashcards
```

```bash
git add -A
```

```bash
git commit -m "Vocab flashcards app"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/YOUR_USERNAME/vocab-flashcards.git
```

```bash
git push -u origin main
```

**If `git push` asks for a password:** GitHub doesn't accept your normal password here. Use one of these instead:

- **Easiest:** install [GitHub Desktop](https://desktop.github.com), sign in, choose **File → Add Local Repository…**, pick the `vocab-flashcards` folder, then click **Publish repository** (or **Push origin**).
- **Or** create a token: GitHub → your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**, tick **repo**, generate, copy it, and paste it as the password.

Refresh the GitHub page: you should see folders like `app`, `components`, `lib` and the README.

> Secrets are safe: `.env` files, the local database (`.pglite`) and `node_modules` are excluded by `.gitignore`.

---

## Part 2: Create your session secret

The app needs one secret value: a random string of at least 32 characters. It signs logins and encrypts users' saved Gemini keys.

In Terminal:

```bash
openssl rand -base64 32
```

Copy the output (something like `k3J9…Q2s=`) and save it somewhere safe, such as your password manager.

> **Don't change it later.** Changing it logs everyone out and makes users paste their Gemini key again.

---

## Part 3: Create the project on Vercel

1. Go to <https://vercel.com/signup> → choose **Hobby** → **Continue with GitHub** and authorise.
2. On the dashboard click **Add New…** → **Project**.
3. Under **Import Git Repository**, find `vocab-flashcards`.
   - If it's not listed, click **Adjust GitHub App Permissions** (or "Install"), choose **Only select repositories** → pick `vocab-flashcards` → **Save**.
4. Click **Import**.
5. On the **Configure Project** screen:
   - **Framework Preset:** Next.js (detected automatically).
   - **Root Directory:** leave `./`.
   - **Build and Output Settings:** leave everything at the defaults. The project's own `build` script runs the database setup and then builds the site.
   - Open **Environment Variables** and add:

     | Key | Value |
     |---|---|
     | `SESSION_SECRET` | the value from Part 2 |

6. Click **Deploy** and wait 1–2 minutes.

The site exists now, but it **has no database yet**. If you open it, you'll see an error. That's expected; the next part fixes it.

---

## Part 4: Add the free database (Neon)

1. In your Vercel project, open the **Storage** tab.
2. Click **Create Database** (or **Connect Database**) → choose **Neon** (Serverless Postgres) → **Continue**.
3. Accept the Neon terms if asked. This creates a free Neon account linked to Vercel.
4. Settings:
   - **Region:** choose the one closest to you. Vercel runs functions in Washington D.C. (`iad1`) by default; choosing a region near that keeps the app fastest. You can change the function region later in Project → Settings → Functions.
   - **Plan:** **Free**.
   - **Database name:** anything, e.g. `vocab`.
5. Click **Create**.
6. On the **Connect to project** step:
   - Tick **Production**, **Preview** and **Development**.
   - Leave **Custom prefix / Environment variable prefix EMPTY**. The app looks for a variable named exactly `DATABASE_URL`.
   - Click **Connect**.
7. Check: Project → **Settings** → **Environment Variables** should now list `DATABASE_URL` (plus a few other Neon variables, which is fine) and your `SESSION_SECRET`.
8. Redeploy so the site picks up the database: **Deployments** tab → ⋯ next to the latest deployment → **Redeploy** → **Redeploy**.

While it builds you can click the deployment to watch the log. Near the top you should see:

```
[migrate] Applying migrations…
[migrate] Database is up to date.
```

That means the tables were created. This runs automatically on every deploy and is safe to repeat.

---

## Part 5: Check that it works

1. Open your site's health check, `https://YOUR-PROJECT.vercel.app/api/health`. You can find the domain on the project's **Overview** page under **Domains**.
   - ✅ `{"ok":true,"db":true}` means everything is connected.
   - ❌ If it shows an `error` message, go to **Troubleshooting** below.
2. Open `https://YOUR-PROJECT.vercel.app`, click **Sign up**, choose a username and password, and create your first deck.
3. Click **📖 Guide** in the top bar. It explains how everything works, including when a word counts as learned.

### Optional: turn on AI for your own account

Every user does this for themselves in the app; nothing is needed in Vercel.

1. Go to <https://aistudio.google.com/apikey> → sign in with Google → **Create API key** → copy it. New keys start with `AQ.`; older `AIza…` keys work too.
2. In the app: **⚙️ Settings** → **✨ AI features** → paste the key → **Save key**.
3. It should say **Connected · key …xxxx**. You now have ✨ Generate deck, better auto-fill, cloud voice, and speech transcription in Firefox. Usage counts only against your own free quota.

Send the same steps to friends who use your app; they can also read them inside the app (Settings → "How do I get a free key?", or the Guide).

### Optional: stop strangers from signing up

Once you and your friends have accounts:

1. Vercel → Project → **Settings** → **Environment Variables** → **Add**: key `ALLOW_SIGNUPS`, value `false`.
2. **Deployments** → ⋯ → **Redeploy**.

The Sign up page will then say "Sign-ups are closed". Existing users can still log in. Remove the variable and redeploy to open sign-ups again.

### Use it on your phone

Open the URL in **Chrome** (Android) or **Safari** (iPhone). Choose **Add to Home Screen** to get an app-like icon. When you first use **Speak**, allow the microphone. On iPhone, make sure the silent switch is off to hear pronunciation.

---

## Part 6: Updating the app later

After changing code on your computer:

```bash
cd ~/Documents/Claude/vocab-flashcards
```

```bash
git add -A
```

```bash
git commit -m "Describe your change"
```

```bash
git push
```

Vercel notices the push and deploys automatically in 1–2 minutes. Database changes (migrations) are applied automatically during the build. Your users, decks, progress and saved Gemini keys are kept: migrations only add new columns and tables.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| `/api/health` says **"DATABASE_URL is not set"** | Part 4 isn't finished: connect the Neon database, check the variable is named exactly `DATABASE_URL` (no prefix), then **Redeploy**. |
| Every page shows an error, and the Vercel **Logs** tab mentions **SESSION_SECRET** | The variable is missing or shorter than 32 characters. Add or fix it in Settings → Environment Variables, then Redeploy. |
| The build fails with `[migrate] Failed` | The database isn't reachable. In Storage, make sure the Neon database exists and is connected, then Redeploy. |
| The first page load after a while is slow (about 1 s) | Normal on the free tier: Neon pauses the database when idle and wakes it on the next visit. |
| Everyone got logged out, and Gemini says "Not connected" | `SESSION_SECRET` was changed. Log in again and paste your Gemini key again. |
| **Speak** is greyed out | Firefox doesn't support speech recognition. Use Chrome, Edge or Safari, or add your Gemini key, which lets Firefox transcribe recordings. Also check Settings → "Enable speaking questions". |
| No sound | Click 🔊 once (browsers block sound until you interact), turn up the volume, check the iPhone silent switch. If the app says your device has no voice for a language, install one in your system's language/speech settings, or add a Gemini key and turn on "Prefer cloud voice". |
| Gemini key: "Google rejected this key" | Copy the key again from AI Studio (the whole `AQ.…` or `AIza…` string, no spaces). The message shows Google's reason. |
| AI features stop working for a while | Your free Gemini quota is used up for now. The app falls back to the free features automatically; try again later. |
| A user forgot their password | There's no email reset by design. See below. |

### Resetting a forgotten password

1. In Terminal, inside the project folder, create a hash for the new password (replace `NewPassword123`):

   ```bash
   cd ~/Documents/Claude/vocab-flashcards
   ```

   ```bash
   node -e "console.log(require('bcryptjs').hashSync('NewPassword123', 11))"
   ```

2. Copy the output (starts with `$2b$11$…`).
3. Vercel → **Storage** → your Neon database → **Open in Neon Console** → **SQL Editor**, and run (replace both values; the username must be all lowercase):

   ```sql
   UPDATE users SET password_hash = '$2b$11$PASTE_HASH_HERE' WHERE username_normalized = 'their_username';
   ```

4. The user can now log in with `NewPassword123` and change it in Settings.

---

## Free-tier notes

- **Vercel Hobby** is free for personal, non-commercial use.
- **Neon Free** includes 0.5 GB of storage, enough for many thousands of cards. Uploaded pictures are compressed to at most 150 KB each.
- **Gemini** usage is billed to each user's own free key, never to you.
