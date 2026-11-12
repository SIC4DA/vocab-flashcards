"use client";
/**
 * Pronunciation (client). Order:
 *  1. a native-speaker recording from Wiktionary / Wikimedia Commons (GET /api/pronounce), if enabled and found;
 *  2. Gemini cloud voice (the user's own key) when they prefer it or the device has no voice;
 *  3. the device's speechSynthesis voice (best-quality voice for the language).
 *
 * iPhone Safari only lets a page start sound from inside a tap, and a brand-new player has to earn that again.
 * So sound goes through players that are unlocked once by any tap or key press on the site (installAudioUnlock):
 * a Web Audio context for recordings (decoded ahead of time, so they start instantly) and one shared <audio>
 * element for other speeds and the cloud voice. iOS puts them back to sleep in the background; the next tap
 * wakes them again.
 */

export type SpeakOptions = {
  /** Try native-speaker recordings first (default true). */
  recordings?: boolean;
  /** Automatic playback (not a button press): skipped until the user has interacted with the page. */
  auto?: boolean;
  rate?: number;
  preferCloud?: boolean;
  cloudAvailable?: boolean;
};

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;
const noVoiceListeners = new Set<(lang: string) => void>();
const cloudCache = new Map<string, string>();
let currentAudio: HTMLAudioElement | null = null;
/** After a cloud-voice failure (e.g. free quota used up), skip it for a while instead of waiting on every word. */
let cloudPausedUntil = 0;

type Recording = { url: string | null; prefix: string | null; attribution: string | null };
const recordingCache = new Map<string, Promise<Recording>>();
const NO_RECORDING: Recording = { url: null, prefix: null, attribution: null };

function getRecording(text: string, lang: string): Promise<Recording> {
  const key = `${lang}\u0000${text.trim().toLowerCase()}`;
  let p = recordingCache.get(key);
  if (!p) {
    p = fetch(`/api/pronounce?${new URLSearchParams({ text: text.trim(), lang })}`)
      .then((r) => (r.ok ? (r.json() as Promise<Recording>) : NO_RECORDING))
      .catch(() => NO_RECORDING);
    recordingCache.set(key, p);
    void p.then((r) => {
      if (r === NO_RECORDING) recordingCache.delete(key); // network error: allow a retry later
    });
  }
  return p;
}

/* ------------------------------ Unlocking ------------------------------ */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
let ctx: AudioContext | null = null;
let sharedAudio: HTMLAudioElement | null = null;
let elementUnlocked = false;
let speechUnlocked = false;
let currentSource: AudioBufferSourceNode | null = null;
/** 0.1 s of silence (8-bit mono WAV): played inside a tap to unlock the shared <audio> element. */
const SILENT_WAV = "data:audio/wav;base64,UklGRjoDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRYDAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA" + "gICA".repeat(250);

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function shared(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    // Recordings come from Wikimedia: fetch them anonymously so no third-party cookies are set.
    sharedAudio.crossOrigin = "anonymous";
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

/** Called inside a tap / key press: wakes every player that isn't allowed to make sound yet. */
export function unlockAudio() {
  const c = audioContext();
  if (c && c.state !== "running") {
    void c.resume().catch(() => {});
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch {
      // ignore: resume() alone is enough on most browsers
    }
  }
  if (!elementUnlocked) {
    const a = shared();
    if (!a.src || a.src === SILENT_WAV || a.paused) {
      a.src = SILENT_WAV;
      a.play().then(
        () => {
          elementUnlocked = true;
          if (a.src === SILENT_WAV) a.pause();
        },
        () => {},
      );
    }
  }
  if (!speechUnlocked && ttsSupported()) {
    speechUnlocked = true;
    const synth = window.speechSynthesis;
    if (!synth.speaking && !synth.pending) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    }
  }
}

const UNLOCK_EVENTS = ["pointerup", "touchend", "click", "keydown"] as const;

/** Any tap or key press anywhere on the site unlocks sound (again, after the page was in the background). */
export function installAudioUnlock(): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    if (elementUnlocked && speechUnlocked && (!ctx || ctx.state === "running")) return;
    unlockAudio();
  };
  for (const e of UNLOCK_EVENTS) window.addEventListener(e, handler, { capture: true, passive: true });
  return () => {
    for (const e of UNLOCK_EVENTS) window.removeEventListener(e, handler, { capture: true });
  };
}

/* ---------------------------- Preloading ----------------------------- */

const bufferCache = new Map<string, Promise<AudioBuffer | null>>();
const MAX_BUFFERS = 150;

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  let p = bufferCache.get(url);
  if (p) return p;
  const c = audioContext();
  if (!c) return Promise.resolve(null);
  p = fetch(url, { mode: "cors", credentials: "omit" })
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((data) => new Promise<AudioBuffer>((resolve, reject) => c.decodeAudioData(data, resolve, reject)))
    .catch(() => {
      bufferCache.delete(url); // allow a retry; the <audio> element is the fallback meanwhile
      return null;
    });
  bufferCache.set(url, p);
  if (bufferCache.size > MAX_BUFFERS) bufferCache.delete(bufferCache.keys().next().value!);
  return p;
}

/** Look up and decode the recording for an upcoming word so it plays instantly. */
export function prefetchPronunciation(text: string, lang: string): Promise<void> {
  if (typeof window === "undefined" || !text.trim()) return Promise.resolve();
  return getRecording(text, lang).then((r) => {
    if (r.url) return loadBuffer(r.url).then(() => undefined);
  });
}

/** Prepare a whole set of words (a few at a time, in order). */
export function prefetchPronunciations(words: { text: string; lang: string }[], parallel = 4) {
  const queue = words.slice();
  const next = (): Promise<void> => {
    const w = queue.shift();
    return w ? prefetchPronunciation(w.text, w.lang).then(next, next) : Promise.resolve();
  };
  for (let i = 0; i < parallel; i++) void next();
}

/* ------------------------------ Playback ------------------------------ */

/** Recordings play at their natural speed through Web Audio (instant, works without a fresh tap on iPhone). */
async function playBuffer(url: string): Promise<boolean> {
  const c = audioContext();
  if (!c) return false;
  const buf = await loadBuffer(url);
  if (!buf) return false;
  if (c.state !== "running") {
    await Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, 150))]);
    if ((c.state as AudioContextState) !== "running") return false; // still asleep: no tap since coming back
  }
  return new Promise((resolve) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    currentSource = src;
    src.onended = () => {
      if (currentSource === src) currentSource = null;
      resolve(true);
    };
    src.start();
    window.dispatchEvent(new CustomEvent("vf:recording-played", { detail: url }));
  });
}

/** Other speeds (slow replay) and the cloud voice: the shared <audio> element keeps the pitch natural. */
function playUrl(url: string, rate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = shared();
    audio.pause();
    audio.src = url;
    audio.playbackRate = rate;
    currentAudio = audio;
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        audio.onended = audio.onerror = null;
        resolve(ok);
      }
    };
    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    audio.play().then(
      () => {
        elementUnlocked = true;
        setTimeout(() => done(true), 6000);
      },
      () => done(false),
    );
  });
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** Chrome loads voices asynchronously; wait for `voiceschanged` (max ~2 s). */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([]);
  if (voicesPromise) return voicesPromise;
  voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const initial = synth.getVoices();
    if (initial.length) return resolve(initial);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.("voiceschanged", finish);
    setTimeout(finish, 2000);
  });
  // Voices can change later (e.g. after installing); refresh the cache when they do.
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    const v = window.speechSynthesis.getVoices();
    if (v.length) voicesPromise = Promise.resolve(v);
  });
  return voicesPromise;
}

const normLang = (l: string) => l.replace("_", "-").toLowerCase();

/** Higher = better sounding. Neural/"Google"/premium voices beat the old compact system voices. */
export function voiceQuality(v: Pick<SpeechSynthesisVoice, "name" | "localService">): number {
  const n = v.name.toLowerCase();
  let q = 0;
  if (/natural|neural|online/.test(n)) q += 4;
  if (/premium|enhanced|siri/.test(n)) q += 3;
  if (/^google /.test(n) || n.includes("google")) q += 2;
  if (/compact|eloquence|espeak|novelty|bad news|bells|bubbles|jester|whisper|zarvox|trinoids|organ|cellos|superstar|boing|albert|fred|junior|ralph|kathy|wobble/.test(n)) q -= 5;
  if (v.localService) q += 0.5;
  return q;
}

const best = (list: SpeechSynthesisVoice[]) => list.slice().sort((a, b) => voiceQuality(b) - voiceQuality(a))[0];

/** Exact language match first, then same language prefix (es-*), else null; best-sounding voice wins. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const target = normLang(lang);
  const prefix = target.split("-")[0];
  const exact = voices.filter((v) => normLang(v.lang) === target);
  if (exact.length) return best(exact);
  const same = voices.filter((v) => normLang(v.lang).split("-")[0] === prefix);
  if (same.length) return best(same);
  return null;
}

export async function hasVoiceFor(lang: string): Promise<boolean> {
  return pickVoice(await loadVoices(), lang) !== null;
}

export function onNoVoice(listener: (lang: string) => void) {
  noVoiceListeners.add(listener);
  return () => {
    noVoiceListeners.delete(listener);
  };
}

export function stopSpeaking() {
  // Only cancel real speech: on iPhone, speech started right after cancel() is often dropped.
  if (ttsSupported() && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // already stopped
    }
    currentSource = null;
  }
}

async function playCloud(text: string, lang: string, rate: number): Promise<boolean> {
  const key = `${lang}\u0000${text}`;
  try {
    let url = cloudCache.get(key);
    if (!url) {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      if (!res.ok) {
        cloudPausedUntil = Date.now() + 10 * 60 * 1000;
        return false;
      }
      url = URL.createObjectURL(await res.blob());
      cloudCache.set(key, url);
    }
    return await playUrl(url, rate);
  } catch {
    return false;
  }
}

function speakBrowser(text: string, lang: string, rate: number, voice: SpeechSynthesisVoice | null): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const busy = synth.speaking || synth.pending;
    if (busy) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    // iPhone drops an utterance queued right after cancel(): give it a moment first.
    if (busy) setTimeout(() => synth.speak(u), 80);
    else synth.speak(u);
    // Some browsers never fire onend; don't hang callers.
    setTimeout(resolve, Math.min(15000, 1500 + text.length * 120));
  });
}

/** Browsers only allow speech after a user gesture; auto-play before that is skipped. */
export function canAutoPlay(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

export async function speak(text: string, lang: string, opts: SpeakOptions = {}): Promise<void> {
  if (!text.trim()) return;
  if (opts.auto && !canAutoPlay()) return;
  const rate = Math.max(0.5, Math.min(1.5, opts.rate ?? 0.9));
  stopSpeaking();
  const voices = await loadVoices();
  const voice = pickVoice(voices, lang);

  if (opts.recordings !== false) {
    const rec = await getRecording(text, lang);
    if (rec.url) {
      // e.g. "der Hund": the recording says "Hund", so say the article first.
      if (rec.prefix && ttsSupported()) await speakBrowser(rec.prefix, lang, rate, voice);
      const natural = Math.abs(rate - 1) <= 0.15;
      if ((natural && (await playBuffer(rec.url))) || (await playUrl(rec.url, rate))) return;
    }
  }
  if (opts.cloudAvailable && (opts.preferCloud || !voice) && Date.now() > cloudPausedUntil) {
    if (await playCloud(text, lang, rate)) return;
  }
  if (!ttsSupported()) return;
  if (!voice) noVoiceListeners.forEach((l) => l(lang));
  await speakBrowser(text, lang, rate, voice);
}
