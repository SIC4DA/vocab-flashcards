"use client";

import { useCallback } from "react";
import { speak } from "@/lib/tts";
import { SlowIcon, SpeakerIcon } from "./icons";
import { useApp } from "./providers";

/** Speak with the user's rate / cloud-voice preferences. */
export function useSpeak() {
  const { settings, gemini } = useApp();
  return useCallback(
    (text: string, lang: string, opts: { slow?: boolean; auto?: boolean } = {}) =>
      speak(text, lang, {
        auto: opts.auto,
        recordings: settings.useRecordings,
        rate: opts.slow ? 0.6 : settings.speechRate,
        preferCloud: gemini && settings.preferCloudVoice,
        cloudAvailable: gemini,
      }),
    [settings.speechRate, settings.preferCloudVoice, settings.useRecordings, gemini],
  );
}

export function AudioButton({
  text,
  lang,
  label,
  slow,
  className = "",
  size = "md",
}: {
  text: string;
  lang: string;
  label?: string;
  slow?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const say = useSpeak();
  const sizes = { sm: 18, md: 22, lg: 30 };
  return (
    <button
      type="button"
      className={`btn-icon ${size === "lg" ? "min-h-14 min-w-14" : ""} ${className}`}
      aria-label={label ?? (slow ? `Play slowly: ${text}` : `Play: ${text}`)}
      title={slow ? "Slow replay" : "Play audio (P)"}
      onClick={(e) => {
        e.stopPropagation();
        void say(text, lang, { slow });
      }}
    >
      {slow ? <SlowIcon size={sizes[size]} /> : <SpeakerIcon size={sizes[size]} />}
    </button>
  );
}
