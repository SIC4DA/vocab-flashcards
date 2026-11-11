import { afterEach, describe, expect, it, vi } from "vitest";
import * as pronounce from "@/app/api/pronounce/route";
import * as autoImage from "@/app/api/cards/[id]/auto-image/route";
import * as geminiKey from "@/app/api/account/gemini-key/route";
import { call } from "../support/route";
import { createDeck, registerUser } from "../support/fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  globalThis.fetch = fn as typeof fetch;
  return fn;
}
const AQ_KEY = "AQ.Ab8RN6Integration-Key_123.xyz7890";

describe("new-format Gemini keys", () => {
  it("accepts an AQ. key verified via countTokens", async () => {
    const a = await registerUser("aqkey");
    const fetchMock = mockFetch((url, init) => {
      expect(url).toContain(":countTokens");
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe(AQ_KEY);
      return json({ totalTokens: 2 });
    });
    const r = await call(geminiKey.PUT, { method: "PUT", cookie: a.cookie, body: { apiKey: AQ_KEY } });
    expect(r.json).toEqual({ hasKey: true, hint: "…7890" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("shows Google's reason when a key is rejected", async () => {
    const a = await registerUser("aqbad");
    mockFetch(() => json({ error: { message: "API key not valid. Please pass a valid API key." } }, 400));
    const r = await call(geminiKey.PUT, { method: "PUT", cookie: a.cookie, body: { apiKey: AQ_KEY } });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toContain("API key not valid");
  });
});

describe("pronunciation recordings", () => {
  it("finds a native recording, plays the article first, and caches the result", async () => {
    const a = await registerUser("listener");
    const fetchMock = mockFetch((url) => {
      expect(url).toContain("de.wiktionary.org");
      expect(decodeURIComponent(url.replace(/\+/g, " "))).toContain("titles=der Hund|der hund|Der hund|Hund|hund");
      return json({
        query: {
          pages: {
            "-1": {
              title: "Datei:De-Hund.ogg",
              videoinfo: [
                {
                  url: "https://upload.wikimedia.org/wikipedia/commons/a/aa/De-Hund.ogg",
                  derivatives: [{ src: "https://upload.wikimedia.org/transcoded/De-Hund.ogg.mp3", type: "audio/mpeg" }],
                  extmetadata: { Artist: { value: "<a>Kampy</a>" }, LicenseShortName: { value: "CC BY-SA 3.0" } },
                },
              ],
            },
            "-2": { title: "Datei:De-gelehriger Hund.ogg", videoinfo: [{ url: "https://upload.wikimedia.org/x.ogg" }] },
          },
        },
      });
    });
    const url = `/api/pronounce?text=${encodeURIComponent("der Hund")}&lang=de-DE`;
    const r = await call(pronounce.GET, { cookie: a.cookie, url });
    expect(r.json).toEqual({
      url: "https://upload.wikimedia.org/transcoded/De-Hund.ogg.mp3",
      prefix: "der",
      attribution: "Recording · by Kampy · CC BY-SA 3.0 · Wikimedia Commons",
    });
    await call(pronounce.GET, { cookie: a.cookie, url });
    expect(fetchMock).toHaveBeenCalledTimes(1); // second call served from the DB cache
  });

  it("returns nothing for sentences and when Wiktionary has no recording", async () => {
    const a = await registerUser("listener2");
    const fetchMock = mockFetch(() => json({ batchcomplete: "" }));
    const long = await call(pronounce.GET, { cookie: a.cookie, url: `/api/pronounce?text=${encodeURIComponent("Ich habe heute keinen Hunger mehr")}&lang=de-DE` });
    expect(long.json.url).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    const none = await call(pronounce.GET, { cookie: a.cookie, url: "/api/pronounce?text=Quatschwort&lang=de-DE" });
    expect(none.json.url).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // de + en Wiktionary
  });

  it("requires login and valid input", async () => {
    expect((await call(pronounce.GET, { url: "/api/pronounce?text=Hund&lang=de-DE" })).status).toBe(401);
    const a = await registerUser("listener3");
    expect((await call(pronounce.GET, { cookie: a.cookie, url: "/api/pronounce?text=Hund&lang=xx_bad" })).status).toBe(400);
  });
});

describe("smart pictures", () => {
  it("without AI, English verb definitions get no picture", async () => {
    const a = await registerUser("noai_pics");
    const { cards } = await createDeck(a.cookie, [{ term: "buchstabieren", definition: "to spell" }]);
    const fetchMock = mockFetch(() => json({ results: [] }));
    const r = await call(autoImage.POST, { method: "POST", cookie: a.cookie, params: { id: cards[0].id } });
    expect(r.json.image).toEqual({ noImage: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
