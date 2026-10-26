import { describe, expect, it } from "vitest";
import { open, seal } from "@/lib/secret-box";

describe("secret box", () => {
  it("round-trips and never contains the plaintext", () => {
    const sealed = seal("AIzaSecretValue123");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("AIzaSecretValue123");
    expect(open(sealed)).toBe("AIzaSecretValue123");
  });
  it("uses a fresh IV every time", () => {
    expect(seal("same")).not.toBe(seal("same"));
  });
  it("returns null for tampered, foreign or empty values", () => {
    const sealed = seal("value");
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(open(parts.join(":"))).toBeNull();
    expect(open("garbage")).toBeNull();
    expect(open(null)).toBeNull();
  });
  it("can't be read with a different SESSION_SECRET", () => {
    const sealed = seal("value");
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a-completely-different-secret-of-32+chars";
    try {
      expect(open(sealed)).toBeNull();
    } finally {
      process.env.SESSION_SECRET = original;
    }
  });
});
