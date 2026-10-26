import "server-only";
import { open } from "./secret-box";

/** The user's own Gemini API key (decrypted), or null when they haven't added one. */
export function userGeminiKey(user: { geminiKeyEnc: string | null }): string | null {
  return open(user.geminiKeyEnc);
}

/** "…abcd" — enough for the user to recognise which key is saved, never the key itself. */
export function keyHint(key: string | null): string | null {
  return key ? `…${key.slice(-4)}` : null;
}
