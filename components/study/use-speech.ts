"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechError, speechRecognitionSupported, startRecognition, startRecording, type RecognitionHandle } from "@/lib/speech";
import { stopSpeaking } from "@/lib/tts";
import { useApp } from "../providers";

export type SpeechFailure = "not-allowed" | "unsupported" | "no-speech" | "failed";

/**
 * Microphone capture: browser SpeechRecognition, or MediaRecorder + /api/transcribe (Gemini)
 * when the browser lacks recognition. Calls onResult with the recognised alternatives.
 */
export function useSpeechCapture(opts: {
  lang: string;
  onResult: (alternatives: string[]) => void;
  onError: (reason: SpeechFailure) => void;
}) {
  const { speechFallback } = useApp();
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const handle = useRef<RecognitionHandle | { stop(): void; abort(): void } | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(
    () => () => {
      handle.current?.abort();
    },
    [],
  );

  const start = useCallback(async () => {
    if (listening || processing) return;
    stopSpeaking();
    setTranscript("");
    if (speechRecognitionSupported()) {
      const h = startRecognition({ lang: optsRef.current.lang, onInterim: setTranscript });
      handle.current = h;
      setListening(true);
      try {
        const alts = await h.result;
        setTranscript(alts[0] ?? "");
        optsRef.current.onResult(alts);
      } catch (err) {
        const code = err instanceof SpeechError ? err.code : "other";
        if (code === "aborted") return;
        optsRef.current.onError(
          code === "not-allowed" ? "not-allowed" : code === "unsupported" ? "unsupported" : code === "no-speech" ? "no-speech" : "failed",
        );
      } finally {
        setListening(false);
        handle.current = null;
      }
      return;
    }
    if (!speechFallback) {
      optsRef.current.onError("unsupported");
      return;
    }
    try {
      const rec = await startRecording(8000);
      let aborted = false;
      handle.current = { stop: rec.stop, abort: () => ((aborted = true), rec.stop()) };
      setListening(true);
      const blob = await rec.result;
      setListening(false);
      handle.current = null;
      if (aborted) return;
      setProcessing(true);
      const form = new FormData();
      form.append("audio", blob, "speech");
      form.append("lang", optsRef.current.lang);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) throw new Error("transcribe failed");
      const { text } = (await res.json()) as { text: string };
      setTranscript(text);
      if (!text.trim()) optsRef.current.onError("no-speech");
      else optsRef.current.onResult([text]);
    } catch (err) {
      setListening(false);
      optsRef.current.onError(err instanceof SpeechError && err.code === "not-allowed" ? "not-allowed" : "failed");
    } finally {
      setProcessing(false);
    }
  }, [listening, processing, speechFallback]);

  const stop = useCallback(() => handle.current?.stop(), []);
  const toggle = useCallback(() => (listening ? stop() : void start()), [listening, start, stop]);

  return { listening, processing, transcript, start, stop, toggle, setTranscript };
}
