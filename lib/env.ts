/** Environment access with validation. Server-only values never reach the client bundle. */

export class ConfigError extends Error {}

export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ConfigError(
      "SESSION_SECRET is missing or shorter than 32 characters. Generate one with `openssl rand -base64 32` " +
        "and set it as an environment variable (see README).",
    );
  }
  return new TextEncoder().encode(secret);
}

export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.6-flash";
export const geminiTtsModel = () => process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts";

export function signupsAllowed(): boolean {
  return (process.env.ALLOW_SIGNUPS ?? "true").toLowerCase() !== "false";
}

/** Base URLs are overridable so tests can point at a local mock server. */
export const apiBase = {
  openverse: () => process.env.OPENVERSE_API_URL || "https://api.openverse.org",
  wikimedia: () => process.env.WIKIMEDIA_API_URL || "https://commons.wikimedia.org",
  mymemory: () => process.env.MYMEMORY_API_URL || "https://api.mymemory.translated.net",
  gemini: () => process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com",
};

export const isProd = () => process.env.NODE_ENV === "production";
