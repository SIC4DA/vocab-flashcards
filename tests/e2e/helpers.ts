import { test as base, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const THUMB = fs.readFileSync(path.join(__dirname, "fixtures/thumb.png"));
const WAV = fs.readFileSync(path.join(__dirname, "fixtures/word.wav"));

/** Deterministic speech-synthesis mock + audio playback tracking, injected before any page script. */
const SPEECH_MOCK = () => {
  type Utt = { text: string; lang: string; rate: number; voice: unknown; onend?: () => void; onerror?: () => void };
  const w = window as unknown as Record<string, unknown>;
  const spoken: { text: string; lang: string; rate: number }[] = [];
  w.__tts = spoken;
  const voices = [
    { name: "Mock Spanish", lang: "es-ES", localService: true, default: false, voiceURI: "mock-es" },
    { name: "Mock English", lang: "en-US", localService: true, default: true, voiceURI: "mock-en" },
  ];
  class Utterance {
    text: string;
    lang = "";
    rate = 1;
    voice: unknown = null;
    onend?: () => void;
    onerror?: () => void;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    speak(u: Utt) {
      spoken.push({ text: u.text, lang: u.lang, rate: u.rate });
      setTimeout(() => u.onend?.(), 20);
    },
    cancel() {},
    pause() {},
    resume() {},
    getVoices: () => voices,
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });

  // Track <audio> playback (native recordings / cloud voice)
  const played: string[] = [];
  w.__played = played;
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    played.push(this.src);
    return origPlay.call(this);
  };
};

type Fixtures = { consoleErrors: string[]; allowConsole: (re: RegExp) => void };

export const test = base.extend<Fixtures & { allowList: RegExp[] }>({
  allowList: async ({}, provide) => {
    await provide([]);
  },
  allowConsole: async ({ allowList }, provide) => {
    await provide((re: RegExp) => allowList.push(re));
  },
  consoleErrors: [
    async ({ page, allowList }, provide) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      await provide(errors);
      const unexpected = errors.filter((e) => !allowList.some((re) => re.test(e)));
      expect(unexpected, "console errors during the test").toEqual([]);
    },
    { auto: true },
  ],
  page: async ({ page }, provide) => {
    await page.addInitScript(SPEECH_MOCK);
    await page.route("https://images.e2e.test/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: THUMB }),
    );
    // Native-speaker recordings (Wikimedia) are served from a local fixture.
    await page.route("https://upload.wikimedia.org/**", (route) =>
      route.fulfill({ status: 200, contentType: "audio/wav", body: WAV, headers: { "Access-Control-Allow-Origin": "*" } }),
    );
    await provide(page);
  },
});

export { expect };

export const uid = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);

export async function registerUI(page: Page, username: string, password = "password123", base = "") {
  await page.goto(`${base}/register`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Your decks" })).toBeVisible();
  // The streak is filled in by the client after hydration, so the page is interactive from here on.
  await expect(page.getByTestId("streak")).not.toContainText("–");
}

/** Register via the API (shares cookies with the page). */
export async function registerAPI(page: Page, username: string, password = "password123", base = "") {
  const r = await page.request.post(`${base}/api/auth/register`, { data: { username, password } });
  expect(r.status()).toBe(201);
}

export type Word = { term: string; definition: string };

export async function createDeckAPI(
  page: Page,
  words: Word[],
  opts: { title?: string; withImages?: boolean; termLang?: string } = {},
): Promise<{ deckId: string; cards: { id: string; term: string; definition: string }[] }> {
  const d = await page.request.post("/api/decks", {
    data: { title: opts.title ?? "Spanish basics", termLang: opts.termLang ?? "es-ES", definitionLang: "en-US" },
  });
  expect(d.status()).toBe(201);
  const deckId = (await d.json()).deck.id as string;
  const r = await page.request.put(`/api/decks/${deckId}/cards`, {
    data: {
      cards: words.map((w, i) => ({
        ...w,
        imageUrl: opts.withImages === false ? null : `https://images.e2e.test/thumb/${i}.png`,
        imageAttribution: "E2E",
      })),
    },
  });
  expect(r.status()).toBe(200);
  return { deckId, cards: (await r.json()).cards };
}

export async function setSettings(page: Page, patch: Record<string, unknown>) {
  const r = await page.request.patch("/api/account/settings", { data: patch });
  expect(r.status()).toBe(200);
}

export const WORDS: Word[] = [
  { term: "la manzana", definition: "apple" },
  { term: "el perro", definition: "dog" },
  { term: "el gato", definition: "cat" },
  { term: "la casa", definition: "house" },
  { term: "el libro", definition: "book" },
  { term: "el café", definition: "coffee" },
];

export const byDefinition = (words: Word[], def: string) => words.find((w) => w.definition === def)!;
export const byTerm = (words: Word[], term: string) => words.find((w) => w.term === term)!;

/** Move cards up the Learn ladder through the API (seen → 3 right answers → Written, stage 4). */
export async function makeKnownAPI(page: Page, cardIds: string[]) {
  for (const cardId of cardIds) {
    await page.request.post("/api/review", { data: { cardId, mode: "learn", questionType: "flashcard", correct: true } });
    for (let i = 0; i < 3; i++) {
      const r = await page.request.post("/api/review", { data: { cardId, mode: "learn", questionType: "mc", correct: true, grade: 4 } });
      expect(r.status()).toBe(200);
    }
  }
}
