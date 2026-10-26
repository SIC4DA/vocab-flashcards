import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getSessionSecret } from "./env";

/**
 * Encrypts small secrets (users' Gemini API keys) at rest with AES-256-GCM.
 * The key is derived from SESSION_SECRET, so changing SESSION_SECRET makes stored keys unreadable
 * (users then simply enter their key again).
 */
function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", getSessionSecret(), "vocab-flashcards", "user-secret-box-v1", 32));
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Returns null when the value can't be decrypted (e.g. SESSION_SECRET changed). */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [v, iv, tag, ct] = sealed.split(":");
    if (v !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
