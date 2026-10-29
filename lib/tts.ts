"use client";
/**
 * Pronunciation (client). Order:
 *  1. a native-speaker recording from Wiktionary / Wikimedia Commons (GET /api/pronounce), if enabled and found;
 *  2. Gemini cloud voice (the user's own key) when they prefer it or the device has no voice;
 *  3. the device's speechSynthesis voice (best-quality voice for the language).
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

/** Look up (and preload) the recording for an upcoming word so it plays instantly. */
export function prefetchPronunciation(text: string, lang: string) {
  if (typeof window === "undefined" || !text.trim()) return;
  void getRecording(text, lang).then((r) => {
    if (r.url) {
      const a = new Audio();
      a.preload = "auto";
      a.crossOrigin = "anonymous";
      a.src = r.url;
    }
  });
}

function playUrl(url: string, rate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio();
    // Recordings come from Wikimedia: fetch them anonymously so no third-party cookies are set.
    audio.crossOrigin = "anonymous";
    audio.src = url;
    audio.playbackRate = rate;
    currentAudio = audio;
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    audio.play().then(
      () => setTimeout(() => done(true), 6000),
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
  if (ttsSupported()) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
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
    const audio = new Audio(url);
    audio.playbackRate = rate;
    currentAudio = audio;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

function speakBrowser(text: string, lang: string, rate: number, voice: SpeechSynthesisVoice | null): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
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
      if (await playUrl(rec.url, rate)) return;
    }
  }
  if (opts.cloudAvailable && (opts.preferCloud || !voice) && Date.now() > cloudPausedUntil) {
    if (await playCloud(text, lang, rate)) return;
  }
  if (!ttsSupported()) return;
  if (!voice) noVoiceListeners.forEach((l) => l(lang));
  await speakBrowser(text, lang, rate, voice);
}
