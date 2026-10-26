"use client";
/** Speech recognition (client): Web Speech API, with a MediaRecorder capture for the Gemini fallback. */

type RecognitionAlternative = { transcript: string; confidence: number };
type RecognitionResult = { isFinal: boolean; length: number; [i: number]: RecognitionAlternative };
type RecognitionEvent = { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } };
type RecognitionErrorEvent = { error: string };

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechend?: (() => void) | null;
};

type Ctor = new () => SpeechRecognitionLike;

function getCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

export function mediaRecorderSupported(): boolean {
  return typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;
}

export class SpeechError extends Error {
  constructor(public code: "not-allowed" | "unsupported" | "no-speech" | "network" | "aborted" | "other") {
    super(code);
  }
}

export type RecognitionHandle = { stop(): void; abort(): void; result: Promise<string[]> };

/**
 * Listen once. Resolves with up to 5 alternatives (plus the combined transcript).
 * Stops automatically after `silenceMs` without new speech or `maxMs` total.
 */
export function startRecognition(opts: {
  lang: string;
  onInterim?: (text: string) => void;
  silenceMs?: number;
  maxMs?: number;
}): RecognitionHandle {
  const Ctor = getCtor();
  if (!Ctor) {
    return { stop() {}, abort() {}, result: Promise.reject(new SpeechError("unsupported")) };
  }
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.interimResults = true;
  rec.maxAlternatives = 5;
  rec.continuous = false;

  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const finals: string[][] = [];
  let interim = "";
  let aborted = false;

  const result = new Promise<string[]>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(silenceTimer);
      clearTimeout(totalTimer);
    };
    const armSilence = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => rec.stop(), opts.silenceMs ?? 5000);
    };
    rec.onresult = (e) => {
      armSilence();
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const alts: string[] = [];
          for (let j = 0; j < r.length; j++) alts.push(r[j].transcript.trim());
          finals.push(alts);
        } else {
          interim += r[0]?.transcript ?? "";
        }
      }
      const shown = [...finals.map((a) => a[0]), interim].filter(Boolean).join(" ");
      opts.onInterim?.(shown);
    };
    rec.onerror = (e) => {
      cleanup();
      const code =
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "not-allowed"
          : e.error === "no-speech"
            ? "no-speech"
            : e.error === "network"
              ? "network"
              : e.error === "aborted"
                ? "aborted"
                : "other";
      reject(new SpeechError(code));
    };
    rec.onend = () => {
      cleanup();
      if (aborted) return reject(new SpeechError("aborted"));
      if (finals.length === 0 && interim) finals.push([interim.trim()]);
      if (finals.length === 0) return reject(new SpeechError("no-speech"));
      const combined = finals.map((a) => a[0]).join(" ").trim();
      const alternatives = finals.length === 1 ? finals[0] : [combined, ...finals[finals.length - 1]];
      resolve(Array.from(new Set(alternatives.filter(Boolean))).slice(0, 6));
    };
    try {
      rec.start();
      armSilence();
      totalTimer = setTimeout(() => rec.stop(), opts.maxMs ?? 8000);
    } catch {
      cleanup();
      reject(new SpeechError("other"));
    }
  });

  return {
    stop: () => rec.stop(),
    abort: () => {
      aborted = true;
      rec.abort();
    },
    result,
  };
}

/** Record ≤ maxMs of audio for server-side transcription. */
export async function startRecording(maxMs = 8000): Promise<{ stop(): void; result: Promise<Blob> }> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new SpeechError("not-allowed");
  }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(
    (m) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(m),
  );
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
  const chunks: Blob[] = [];
  const result = new Promise<Blob>((resolve) => {
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: (recorder.mimeType || mime || "audio/webm").split(";")[0] }));
    };
  });
  recorder.start();
  const timer = setTimeout(() => recorder.state !== "inactive" && recorder.stop(), maxMs);
  return {
    stop: () => {
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
    },
    result,
  };
}
