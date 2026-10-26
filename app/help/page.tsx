import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { DEFAULT_SETTINGS } from "@/lib/validation";

export const metadata: Metadata = { title: "How it works" };

const TOC = [
  ["start", "Quick start"],
  ["learned", "When is a word “learned”?"],
  ["modes", "Study modes"],
  ["which-modes", "Which modes count towards mastering?"],
  ["reviews", "Reviews, due cards and streaks"],
  ["checking", "How answers are checked"],
  ["audio", "Audio, speaking and your browser"],
  ["images", "Pictures"],
  ["ai", "AI features (your own Gemini key)"],
  ["settings", "Settings explained"],
  ["shortcuts", "Keyboard shortcuts"],
  ["account", "Your account and privacy"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 pt-4 text-2xl font-extrabold">
      {children}
    </h2>
  );
}

export default async function HelpPage() {
  const user = await getCurrentUser();
  const s = user?.settings ?? DEFAULT_SETTINGS;
  const n = s.advanceAfter;
  const times = n === 1 ? "once" : n === 2 ? "twice in a row" : `${n} times in a row`;
  const minAnswersWithSpeak = 5 * n;
  const minAnswersNoSpeak = 4 * n;

  const ladder: [string, string, string, string][] = [
    ["0", "New", "You see the card: word, meaning, picture and pronunciation.", "Just look at it and continue"],
    ["1", "Seen", "Multiple choice: you see the word (and hear it) and pick its meaning from 4 options.", `Right ${times}`],
    [
      "2",
      "Recognized",
      "Listening multiple choice (you only hear the word) and reverse multiple choice (you see the meaning + picture and pick the word).",
      `Right ${times}`,
    ],
    ["3", "Heard", "Dictation: you hear the word and type it.", `Right ${times}`],
    ["4", "Written", "Writing: you see the meaning + picture and type the word.", `Right ${times}`],
    [
      "5",
      "Spoken",
      "Speaking: you see the meaning + picture and say the word into the microphone. Skipped if speaking isn't available or is turned off.",
      `Right ${times}`,
    ],
    ["6", "Mastered", "The word is learned. From now on it comes back in spaced reviews.", "—"],
  ];

  return (
    <article className="mx-auto max-w-3xl space-y-4 pb-10 leading-relaxed">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">Guide</p>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">How Vocab Flashcards works</h1>
        <p className="text-muted">
          Everything you need to know: how words move from “new” to “learned”, what each study mode does, and how to set
          things up.
          {user && " Numbers on this page use your current settings."}
        </p>
      </header>

      <nav aria-label="On this page" className="panel p-4">
        <p className="mb-2 text-sm font-bold">On this page</p>
        <ol className="grid list-decimal gap-x-6 gap-y-1 pl-5 text-sm sm:grid-cols-2">
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-accent hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <H2 id="start">Quick start</H2>
      <ol className="list-decimal space-y-2 pl-6">
        <li>
          <b>Create a deck</b> (<Link href="/decks/new" className="text-accent underline">＋ Create deck</Link>): choose the
          language you’re learning (term language) and your own language (definition language).
        </li>
        <li>
          <b>Add words</b>: type a term and its meaning, use <b>✨ Auto-fill definition</b> to get a suggestion, or paste a
          whole list with <b>📋 Bulk import</b> (one word per line: <code>la casa - house</code>). Press <b>Save</b>. Pictures are
          found automatically.
        </li>
        <li>
          <b>Press Learn</b> on the deck and practise for a few minutes every day. Come back when the dashboard shows cards
          <b> due today</b> and press <b>Review all due</b>.
        </li>
      </ol>

      <H2 id="learned">When is a word “learned”?</H2>
      <p>
        Every word climbs a <b>ladder of 7 stages</b>. Easy tasks come first (recognising the word), hard ones last
        (producing it by writing, then by speaking). A word is <b>learned (“Mastered”) only after it has passed every
        stage</b>: you recognised it by sight and by ear, wrote it from dictation, wrote it from its meaning, and said it
        correctly out loud.
      </p>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">The learning ladder</caption>
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Stage</th>
              <th scope="col" className="px-3 py-2">What you do</th>
              <th scope="col" className="px-3 py-2">To move up</th>
            </tr>
          </thead>
          <tbody>
            {ladder.map(([num, name, what, up]) => (
              <tr key={num} className="border-t border-line align-top">
                <td className="whitespace-nowrap px-3 py-2 font-bold">
                  {num} · {name}
                </td>
                <td className="px-3 py-2">{what}</td>
                <td className="whitespace-nowrap px-3 py-2">{up}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-2 pl-6">
        <li>
          <b>Moving up:</b> a word moves up one stage after you answer it correctly <b>{times}</b> at its current stage
          (setting “Correct answers to advance a stage”, currently <b>{n}</b>). So a word needs at least{" "}
          <b>{minAnswersWithSpeak} correct answers</b> after you first see it ({minAnswersNoSpeak} if speaking is skipped).
        </li>
        <li>
          <b>Mistakes:</b> a wrong answer moves the word <b>down one stage</b> (never below “Seen”), resets the count, shows you
          the right answer, and the word comes back <b>3–5 questions later</b> in the same session.
        </li>
        <li>
          <b>No microphone?</b> If your browser can’t do speech recognition (e.g. Firefox) or you turned speaking off, the
          Spoken stage is skipped: the word goes from Written straight to Mastered.
        </li>
        <li>
          <b>Mastered isn’t forever:</b> mastered words come back in spaced reviews. If you get one wrong in a review, it
          drops back to <b>Written</b> and must be written and said correctly again to become Mastered.
        </li>
        <li>
          You can see each word’s stage, next review date and right/wrong counts in the table on the deck page, and reset
          a single word or the whole deck there.
        </li>
      </ul>

      <H2 id="modes">Study modes</H2>
      <dl className="space-y-3">
        {[
          ["🧠 Learn", "The main mode. Picks the right question for each word’s stage (see the ladder). Works in rounds of a few words; after each round you see which words moved up and which you missed. New words are limited per day."],
          ["🃏 Flashcards", "Flip cards (tap, click or Space). Sort them with “Know it” (→) or “Still learning” (←), or swipe on a phone. At the end you can study only the still-learning ones again. Options: shuffle, definition first."],
          ["✍️ Write", "Every word as a writing question in random order. Wrong ones come back at the end."],
          ["🎧 Listen", "Dictation: you only hear the word (🔊 replay, 🐢 slow) and type it."],
          ["🎤 Speak", "See the meaning and say the word. You can always skip or type instead."],
          ["🎯 Match", "Match 6 words with their meanings as fast as you can. Wrong pairs add 1 second. Your best time per deck is saved."],
          ["📝 Test", "A generated exam: choose how many questions and which types (multiple choice, write, listen & write, speak, true/false). You get a score, pass/fail (pass mark in Settings), and can retake only the ones you missed."],
          ["🔁 Review all due", "From the dashboard: practises every word that is due today, across all your decks."],
        ].map(([t, d]) => (
          <div key={t} className="panel p-4">
            <dt className="font-bold">{t}</dt>
            <dd className="mt-1 text-sm text-muted">{d}</dd>
          </div>
        ))}
      </dl>

      <H2 id="which-modes">Which modes count towards mastering?</H2>
      <ul className="list-disc space-y-2 pl-6">
        <li>
          <b>Learn</b> and <b>Review all due</b> move words up and down the ladder.
        </li>
        <li>
          <b>Flashcards</b>: “Know it” only moves a New word to Seen; it never makes a word Mastered.
        </li>
        <li>
          <b>Write, Listen, Speak and Test</b> are extra practice: they update when a word is next due and your accuracy
          stats, but don’t climb the ladder (a mistake on a Mastered word still sends it back to Written).
        </li>
        <li>
          <b>Match</b> is a game: it saves your best time but doesn’t change word progress.
        </li>
        <li>Every answer is saved immediately — you can close the tab at any time without losing progress.</li>
      </ul>

      <H2 id="reviews">Reviews, due cards and streaks</H2>
      <p>
        The app uses <b>spaced repetition</b> (a simplified SM-2 algorithm) to bring words back right before you’d forget
        them.
      </p>
      <ul className="list-disc space-y-2 pl-6">
        <li>
          Words you’re still learning come back <b>the next day</b> after a right answer, or straight away after a mistake.
        </li>
        <li>
          Mastered words come back after <b>1 day</b>, then <b>6 days</b>, then at growing intervals (roughly 2–3× longer
          each time; faster, confident answers make the gaps grow faster).
        </li>
        <li>
          A word is <b>due</b> when its review date has arrived. The dashboard shows how many are due today; press{" "}
          <b>Review all due</b> to clear them. Mastered words are reviewed mostly by writing (40%) and speaking (30%), then
          dictation (20%) and multiple choice (10%).
        </li>
        <li>
          Your <b>streak 🔥</b> counts the days in a row on which you answered at least one question.
        </li>
      </ul>

      <H2 id="checking">How answers are checked</H2>
      <ul className="list-disc space-y-2 pl-6">
        <li>Upper/lower case, extra spaces and punctuation at the end don’t matter.</li>
        <li>
          <b>Accents:</b> typing <i>cafe</i> for <i>café</i> counts as correct and shows “Almost — watch the accents”. Turn on{" "}
          <b>Strict accents</b> in Settings to count it as wrong.
        </li>
        <li>
          <b>Small typos</b> (1 letter wrong in words of 5+ letters, 2 in words of 10+) show “Almost right” with the
          difference highlighted. They count as wrong unless you press <b>“I was right”</b>.
        </li>
        <li>
          <b>Several answers:</b> write meanings like <code>car / automobile</code> or <code>car; auto</code> and any of them is
          accepted.
        </li>
        <li>
          <b>Articles:</b> turn on <b>Ignore articles</b> to accept <i>casa</i> for <i>la casa</i>.
        </li>
        <li>
          A <b>special-characters bar</b> (á, ñ, ü, ß, ç…) appears under the answer box for your term language.
        </li>
        <li>
          <b>Speaking</b> is checked against everything the browser thinks you might have said; it passes if one of them is
          the word or very close to it (80% similar). Accents and punctuation are ignored.
        </li>
      </ul>

      <H2 id="audio">Audio, speaking and your browser</H2>
      <ul className="list-disc space-y-2 pl-6">
        <li>
          Pronunciation uses your device’s built-in voices. Press 🔊 or <kbd>P</kbd> any time; 🐢 plays slowly. If your device
          has no voice for a language you’ll see a notice — install one in your system’s speech/language settings, or add a
          Gemini key for a cloud voice.
        </li>
        <li>
          Browsers only allow sound after you’ve clicked or tapped something on the page, so auto-play may stay silent on a
          page you opened directly — just press 🔊.
        </li>
        <li>
          <b>Speaking</b> works in <b>Chrome, Edge and Safari</b> (desktop and mobile). <b>Firefox</b> doesn’t support speech
          recognition: Speak mode is disabled there, unless you add a Gemini key (then your recording is transcribed by
          Gemini). The first time, your browser asks for microphone permission — choose <b>Allow</b>. If you block it,
          speaking questions turn into writing questions for that session.
        </li>
        <li>
          On a phone, <b>hold</b> the 🎤 button while you speak. With a mouse, click once to start and once to stop (or press{" "}
          <kbd>M</kbd>). Listening stops by itself after 5 seconds of silence.
        </li>
      </ul>

      <H2 id="images">Pictures</H2>
      <p>
        When you save a card without a picture, the app searches openly licensed images (Openverse, then Wikimedia Commons)
        using the meaning. In the editor, click the picture box to <b>choose another image</b>, <b>upload your own</b> (it’s
        shrunk automatically), <b>paste an image link</b>, or <b>remove</b> it. The photographer and licence are shown under
        the picture on the back of the card.
      </p>

      <H2 id="ai">AI features (your own Gemini key)</H2>
      <p>
        Everything works without AI. Each user can optionally add <b>their own free Google Gemini API key</b> in{" "}
        <Link href="/settings" className="text-accent underline">Settings</Link>. Your key is only used for your own
        requests, so you stay within your own free quota.
      </p>
      <ol className="list-decimal space-y-1 pl-6">
        <li>
          Go to{" "}
          <a href="https://aistudio.google.com/apikey" className="text-accent underline" target="_blank" rel="noopener noreferrer">
            aistudio.google.com/apikey
          </a>{" "}
          and sign in with Google.
        </li>
        <li>Click <b>Create API key</b> and copy it (it starts with “AIza”).</li>
        <li>
          In <b>Settings → AI features</b>, paste it and press <b>Save key</b>. The app checks it with Google and shows
          “Connected”.
        </li>
      </ol>
      <p>With a key you get:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Better <b>Auto-fill definition</b>, plus an example sentence.</li>
        <li>Smarter picture search when your definitions aren’t in English.</li>
        <li>A <b>cloud voice</b> when your device has no voice for a language (or always, with “Prefer cloud voice”).</li>
        <li>Speaking practice in browsers without speech recognition.</li>
        <li>
          <b>✨ Generate deck</b>: type a topic (e.g. “kitchen items”) and get up to 30 cards to review and edit before saving.
        </li>
      </ul>
      <p className="text-sm text-muted">
        Your key is stored encrypted, never shown again, and you can remove it any time. If Gemini is busy or your free
        quota runs out, the app quietly falls back to the free non-AI features.
      </p>

      <H2 id="settings">Settings explained</H2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]">
        {[
          ["Auto-play term / definition", "Speak the word (or the meaning) automatically when a card appears."],
          ["Speech rate", "How fast words are spoken (0.5–1.5×)."],
          ["Prefer cloud voice", "Use Gemini’s voice instead of your device’s (only with your Gemini key)."],
          ["Sound effects", "Short tones for right and wrong answers."],
          ["Enable speaking questions", "Turn off if you can’t use a microphone; the Spoken stage is then skipped."],
          ["Strict accents", "Count answers with wrong or missing accents as wrong."],
          ["Ignore articles", "Accept answers without “the / el / la / der / le …”."],
          [`Correct answers to advance a stage (now ${n})`, "How many right answers in a row move a word up the ladder (1–3)."],
          [`New cards per day (now ${s.newPerDay})`, "How many new words Learn introduces per day."],
          [`Learn round size (now ${s.roundSize})`, "How many words are in each Learn round."],
          [`Test pass mark (now ${s.passMark}%)`, "The score you need to pass a Test."],
          ["Theme", "Light, dark, or follow your device."],
        ].map(([t, d]) => (
          <div key={t} className="contents">
            <dt className="font-semibold">{t}</dt>
            <dd className="mb-2 text-muted sm:mb-0">{d}</dd>
          </div>
        ))}
      </dl>

      <H2 id="shortcuts">Keyboard shortcuts</H2>
      <p className="text-sm">
        <kbd>Space</kbd> flip / play audio · <kbd>P</kbd> play audio · <kbd>Enter</kbd> check / continue · <kbd>←</kbd> /{" "}
        <kbd>→</kbd> still learning / know it · <kbd>1</kbd>–<kbd>4</kbd> pick an option · <kbd>M</kbd> microphone ·{" "}
        <kbd>Esc</kbd> leave the session · <kbd>?</kbd> show the list. Shortcuts (except Enter) are ignored while you type.
      </p>

      <H2 id="account">Your account and privacy</H2>
      <ul className="list-disc space-y-2 pl-6">
        <li>Your decks are private: nobody else can see them.</li>
        <li>
          There is no email, so <b>a forgotten password can’t be reset</b> — keep it in a password manager. You can change it
          in Settings while logged in.
        </li>
        <li>
          <b>Delete account</b> (Settings) permanently removes your account, decks, progress and saved Gemini key.
        </li>
        <li>You can export any deck as a CSV file from the deck page.</li>
      </ul>

      <p className="pt-4">
        <Link href={user ? "/" : "/register"} className="btn-primary">
          {user ? "Back to my decks" : "Create a free account"}
        </Link>
      </p>
    </article>
  );
}
