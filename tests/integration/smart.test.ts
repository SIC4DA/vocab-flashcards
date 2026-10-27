import { afterEach, describe, expect, it, vi } from "vitest";
import * as pronounce from "@/app/api/pronounce/route";
import * as organize from "@/app/api/decks/[id]/organize/route";
import * as autoImage from "@/app/api/cards/[id]/auto-image/route";
import * as geminiKey from "@/app/api/account/gemini-key/route";
import * as deck from "@/app/api/decks/[id]/route";
import * as deckCards from "@/app/api/decks/[id]/cards/route";
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

async function withKey(cookie: string) {
  mockFetch(() => json({ totalTokens: 2 }));
  const r = await call(geminiKey.PUT, { method: "PUT", cookie, body: { apiKey: AQ_KEY } });
  expect(r.status).toBe(200);
  globalThis.fetch = realFetch;
}

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

describe("smart pictures and topics", () => {
  it("without AI, English verb definitions get no picture", async () => {
    const a = await registerUser("noai_pics");
    const { cards } = await createDeck(a.cookie, [{ term: "buchstabieren", definition: "to spell" }]);
    const fetchMock = mockFetch(() => json({ results: [] }));
    const r = await call(autoImage.POST, { method: "POST", cookie: a.cookie, params: { id: cards[0].id } });
    expect(r.json.image).toEqual({ noImage: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("organize: AI decides pictures and topics, keeps the user's own picture choices", async () => {
    const a = await registerUser("organizer");
    const { deckId, cards } = await createDeck(a.cookie, [
      { term: "das Handtuch", definition: "towel" },
      { term: "buchstabieren", definition: "to spell" },
      { term: "die Wurst", definition: "sausage" },
      { term: "denken", definition: "to think" },
    ]);
    // Give "to spell" an automatic picture and "to think" a picture the user picked.
    await call(deckCards.PUT, {
      method: "PUT",
      cookie: a.cookie,
      params: { id: deckId },
      body: {
        cards: [
          { id: cards[0].id, term: "das Handtuch", definition: "towel" },
          { id: cards[1].id, term: "buchstabieren", definition: "to spell", imageUrl: "https://img.test/spell.jpg", imageSource: "auto" },
          { id: cards[2].id, term: "die Wurst", definition: "sausage" },
          { id: cards[3].id, term: "denken", definition: "to think", imageUrl: "https://img.test/think.jpg", imageSource: "picked" },
        ],
      },
    });
    expect((await call(organize.POST, { cookie: a.cookie, params: { id: deckId }, body: {} })).status).toBe(404); // no key yet
    await withKey(a.cookie);
    let prompt = "";
    mockFetch(async (_url, init) => {
      prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text;
      return json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    { i: 0, image: true, keyword: "bath towel", group: "Bathroom" },
                    { i: 1, image: false, keyword: "", group: "Everyday verbs" },
                    { i: 2, image: true, keyword: "sausage", group: "Food" },
                    { i: 3, image: false, keyword: "", group: "Everyday verbs" },
                  ]),
                },
              ],
            },
          },
        ],
      });
    });
    const r = await call(organize.POST, { cookie: a.cookie, params: { id: deckId }, body: {} });
    expect(r.status).toBe(200);
    expect(prompt).toContain("buchstabieren");
    expect(r.json.cards.find((c: { id: string }) => c.id === cards[1].id)).toMatchObject({ noImage: true, imageRemoved: true });
    const d = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    const byTerm = Object.fromEntries(d.json.cards.map((c: { term: string }) => [c.term, c]));
    expect(byTerm["buchstabieren"]).toMatchObject({ noImage: true, imageUrl: null, groupLabel: "Everyday verbs" });
    expect(byTerm["denken"]).toMatchObject({ noImage: false, imageUrl: "https://img.test/think.jpg" }); // user's choice kept
    expect(byTerm["das Handtuch"]).toMatchObject({ noImage: false, groupLabel: "Bathroom" });

    // The AI keyword is used for the picture search
    let searched = "";
    mockFetch((url) => {
      searched = url;
      return json({ results: [{ url: "https://img.test/t.jpg", thumbnail: "https://img.test/t-thumb.jpg", width: 800, height: 600, filetype: "jpg" }] });
    });
    const img = await call(autoImage.POST, { method: "POST", cookie: a.cookie, params: { id: cards[0].id } });
    expect(img.json.image.imageUrl).toBe("https://img.test/t-thumb.jpg");
    expect(searched).toContain("q=bath+towel");

    // Editing a word clears its topic so it gets re-organised
    await call(deckCards.PUT, {
      method: "PUT",
      cookie: a.cookie,
      params: { id: deckId },
      body: { cards: d.json.cards.map((c: { id: string; term: string; definition: string }) => ({ id: c.id, term: c.term, definition: c.term === "die Wurst" ? "sausage / wurst" : c.definition })) },
    });
    const d2 = await call(deck.GET, { cookie: a.cookie, params: { id: deckId } });
    expect(d2.json.cards.find((c: { term: string }) => c.term === "die Wurst").groupLabel).toBeNull();
    expect(d2.json.cards.find((c: { term: string }) => c.term === "das Handtuch").groupLabel).toBe("Bathroom");
  });
});
