import { afterEach, describe, expect, it, vi } from "vitest";
import * as config from "@/app/api/config/route";
import * as health from "@/app/api/health/route";
import * as translate from "@/app/api/translate/route";
import * as search from "@/app/api/images/search/route";
import * as autoImage from "@/app/api/cards/[id]/auto-image/route";
import * as tts from "@/app/api/tts/route";
import * as generate from "@/app/api/generate-deck/route";
import * as geminiKey from "@/app/api/account/gemini-key/route";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { call } from "../support/route";
import { createDeck, registerUser } from "../support/fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const USER_KEY = "AIzaTestKey_user_1234567890abcd";

/** Save a Gemini key for this user (Google's key check is mocked as "valid"). */
async function addKey(cookie: string, key = USER_KEY) {
  const before = globalThis.fetch;
  mockFetch(() => json({ models: [] }));
  const r = await call(geminiKey.PUT, { method: "PUT", cookie, body: { apiKey: key } });
  globalThis.fetch = before;
  expect(r.status).toBe(200);
  return r;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("health and config", () => {
  it("reports DB status and per-user feature flags", async () => {
    expect((await call(health.GET)).json).toEqual({ ok: true, db: true });
    expect((await call(config.GET)).json).toEqual({ gemini: false, signups: true });
    const a = await registerUser("cfguser");
    expect((await call(config.GET, { cookie: a.cookie })).json.gemini).toBe(false);
    await addKey(a.cookie);
    expect((await call(config.GET, { cookie: a.cookie })).json.gemini).toBe(true);
    // Another user is unaffected
    const b = await registerUser("cfguser2");
    expect((await call(config.GET, { cookie: b.cookie })).json.gemini).toBe(false);
  });
});

describe("per-user Gemini key", () => {
  it("is verified, stored encrypted, never returned, and removable", async () => {
    const a = await registerUser("keyowner");
    let seenHeader = "";
    mockFetch((url, init) => {
      expect(url).toContain("/v1beta/models");
      seenHeader = (init?.headers as Record<string, string>)["x-goog-api-key"];
      return json({ models: [] });
    });
    const r = await call(geminiKey.PUT, { method: "PUT", cookie: a.cookie, body: { apiKey: USER_KEY } });
    expect(r.json).toEqual({ hasKey: true, hint: "…abcd" });
    expect(seenHeader).toBe(USER_KEY);
    expect(r.text).not.toContain(USER_KEY);
    const db = await getDb();
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, a.user.id));
    expect(row.geminiKeyEnc).toBeTruthy();
    expect(row.geminiKeyEnc).not.toContain(USER_KEY);
    const del = await call(geminiKey.DELETE, { method: "DELETE", cookie: a.cookie });
    expect(del.json.hasKey).toBe(false);
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, a.user.id));
    expect(after.geminiKeyEnc).toBeNull();
  });

  it("rejects keys Google refuses and malformed keys", async () => {
    const a = await registerUser("badkey");
    mockFetch(() => json({ error: { message: "API key not valid" } }, 400));
    const r = await call(geminiKey.PUT, { method: "PUT", cookie: a.cookie, body: { apiKey: USER_KEY } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("invalid_key");
    expect((await call(geminiKey.PUT, { method: "PUT", cookie: a.cookie, body: { apiKey: "short" } })).status).toBe(400);
    expect((await call(geminiKey.PUT, { method: "PUT", body: { apiKey: USER_KEY } })).status).toBe(401);
  });

  it("each user's requests use their own key", async () => {
    const a = await registerUser("ownkey_a");
    const b = await registerUser("ownkey_b");
    await addKey(a.cookie, "AIzaKeyForUserA_000000000000");
    await addKey(b.cookie, "AIzaKeyForUserB_111111111111");
    const used: string[] = [];
    mockFetch((url, init) => {
      if (url.includes("generativelanguage")) used.push((init?.headers as Record<string, string>)["x-goog-api-key"]);
      return json({ candidates: [{ content: { parts: [{ text: '{"translation":"x"}' }] } }] });
    });
    await call(translate.POST, { cookie: a.cookie, body: { text: "hola", from: "es-ES", to: "en-US" } });
    await call(translate.POST, { cookie: b.cookie, body: { text: "hola", from: "es-ES", to: "en-US" } });
    expect(used).toEqual(["AIzaKeyForUserA_000000000000", "AIzaKeyForUserB_111111111111"]);
  });
});

describe("images", () => {
  it("uses Openverse, falls back to Wikimedia, and auto-fills cards", async () => {
    const a = await registerUser("imguser");
    const { cards } = await createDeck(a.cookie, [{ term: "el perro", definition: "dog" }]);
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.includes("openverse")) return json({ results: [] });
      return json({
        query: {
          pages: {
            "1": {
              index: 1,
              imageinfo: [
                {
                  thumburl: "https://upload.wikimedia.org/dog.jpg",
                  url: "https://upload.wikimedia.org/dog-full.jpg",
                  width: 800,
                  height: 600,
                  mime: "image/jpeg",
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Dog.jpg",
                  extmetadata: { Artist: { value: "<a>Jane</a>" }, LicenseShortName: { value: "CC BY-SA 4.0" } },
                },
              ],
            },
          },
        },
      });
    });
    const r = await call(autoImage.POST, { method: "POST", cookie: a.cookie, params: { id: cards[0].id } });
    expect(r.json.image.imageUrl).toBe("https://upload.wikimedia.org/dog.jpg");
    expect(r.json.image.imageAttribution).toContain("by Jane, CC BY-SA 4.0");
    expect(calls[0]).toContain("openverse");
    expect(calls[0]).toContain("q=dog");
    expect(calls[0]).toContain("mature=false");
    expect(calls[1]).toContain("wikimedia");
  });

  it("never fails when both sources are down", async () => {
    const a = await registerUser("imguser2");
    const { cards } = await createDeck(a.cookie, [{ term: "x", definition: "zzzunfindable" }]);
    mockFetch(() => {
      throw new Error("network down");
    });
    const r = await call(autoImage.POST, { method: "POST", cookie: a.cookie, params: { id: cards[0].id } });
    expect(r.status).toBe(200);
    expect(r.json.image).toBeNull();
    const s = await call(search.GET, { cookie: a.cookie, url: "/api/images/search?q=zzzunfindable" });
    expect(s.json.results).toEqual([]);
  });
});

describe("translate", () => {
  it("uses MyMemory without Gemini", async () => {
    const a = await registerUser("transuser");
    mockFetch((url) => {
      expect(url).toContain("mymemory");
      expect(url).toContain("langpair=es-ES%7Cen-US");
      return json({ responseStatus: 200, responseData: { translatedText: "apple" } });
    });
    const r = await call(translate.POST, { cookie: a.cookie, body: { text: "manzana", from: "es-ES", to: "en-US" } });
    expect(r.json).toEqual({ translation: "apple", source: "mymemory" });
  });

  it("uses the user's Gemini key and falls back to MyMemory on failure", async () => {
    const a = await registerUser("transuser2");
    await addKey(a.cookie);
    mockFetch((url, init) => {
      if (url.includes("generativelanguage")) {
        expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe(USER_KEY);
        return json({ candidates: [{ content: { parts: [{ text: '{"translation":"apple","example":"Como una manzana."}' }] } }] });
      }
      return json({ responseStatus: 200, responseData: { translatedText: "apple (mm)" } });
    });
    const r = await call(translate.POST, { cookie: a.cookie, body: { text: "manzana", from: "es-ES", to: "en-US" } });
    expect(r.json).toEqual({ translation: "apple", example: "Como una manzana.", source: "gemini" });

    mockFetch((url) => (url.includes("generativelanguage") ? json({}, 500) : json({ responseStatus: 200, responseData: { translatedText: "apple (mm)" } })));
    const fb = await call(translate.POST, { cookie: a.cookie, body: { text: "manzana", from: "es-ES", to: "en-US" } });
    expect(fb.json.source).toBe("mymemory");
  });
});

describe("gemini-only routes", () => {
  it("are unavailable until the user adds a key", async () => {
    const a = await registerUser("nogemini");
    expect((await call(tts.POST, { cookie: a.cookie, body: { text: "hola", lang: "es-ES" } })).status).toBe(404);
    expect((await call(generate.POST, { cookie: a.cookie, body: { topic: "food", termLang: "es-ES", definitionLang: "en-US", count: 3 } })).status).toBe(404);
  });

  it("tts converts PCM to WAV and caches it", async () => {
    const a = await registerUser("ttsuser");
    await addKey(a.cookie);
    let n = 0;
    mockFetch(() => {
      n++;
      return json({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.alloc(480).toString("base64") } }] } }],
      });
    });
    const r1 = await call(tts.POST, { cookie: a.cookie, body: { text: "hola", lang: "es-ES" } });
    expect(r1.res.headers.get("content-type")).toBe("audio/wav");
    expect(r1.text.slice(0, 4)).toBe("RIFF");
    await call(tts.POST, { cookie: a.cookie, body: { text: "hola", lang: "es-ES" } });
    expect(n).toBe(1);
  });

  it("generate-deck validates Gemini JSON", async () => {
    const a = await registerUser("genuser");
    await addKey(a.cookie);
    mockFetch(() =>
      json({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify([{ term: "la cuchara", definition: "spoon", example: "Necesito una cuchara." }, { term: "el plato", definition: "plate" }]) }],
            },
          },
        ],
      }),
    );
    const r = await call(generate.POST, { cookie: a.cookie, body: { topic: "kitchen", termLang: "es-ES", definitionLang: "en-US", count: 2 } });
    expect(r.status).toBe(200);
    expect(r.json.cards).toEqual([
      { term: "la cuchara", definition: "spoon", example: "Necesito una cuchara." },
      { term: "el plato", definition: "plate", example: "" },
    ]);
    mockFetch(() => json({ candidates: [{ content: { parts: [{ text: '[{"nope":1}]' }] } }] }));
    expect((await call(generate.POST, { cookie: a.cookie, body: { topic: "kitchen", termLang: "es-ES", definitionLang: "en-US", count: 2 } })).status).toBe(502);
  });
});
