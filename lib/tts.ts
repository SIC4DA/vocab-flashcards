"use client";
/**
 * Text-to-speech (client). Browser speechSynthesis by default; optional Gemini cloud voice
 * via POST /api/tts when no local voice exists or the user prefers it.
 */

export type SpeakOptions = {
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

/** Exact language match first, then same language prefix (es-*), else null. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const target = normLang(lang);
  const prefix = target.split("-")[0];
  const exact = voices.filter((v) => normLang(v.lang) === target);
  if (exact.length) return exact.find((v) => v.localService) ?? exact[0];
  const same = voices.filter((v) => normLang(v.lang).split("-")[0] === prefix);
  if (same.length) return same.find((v) => v.localService) ?? same[0];
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
      if (!res.ok) return false;
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
  if (opts.cloudAvailable && (opts.preferCloud || !voice)) {
    if (await playCloud(text, lang, rate)) return;
  }
  if (!ttsSupported()) return;
  if (!voice) noVoiceListeners.forEach((l) => l(lang));
  await speakBrowser(text, lang, rate, voice);
}
