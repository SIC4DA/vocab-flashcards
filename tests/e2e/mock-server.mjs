// Local stand-in for Openverse, Wikimedia, MyMemory and Gemini during E2E runs.
// The app's server-side fetches are pointed here via *_API_URL env vars.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 3199);
const VALID_KEY = "AQ.Ab8RN6E2EValidGeminiKey_1234567890";

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function gemini(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (url.pathname === "/v1/images/") {
      const q = url.searchParams.get("q") ?? "x";
      const slug = encodeURIComponent(q.replace(/\s+/g, "-"));
      return send(res, 200, {
        results: Array.from({ length: 10 }, (_, i) => ({
          url: `https://images.e2e.test/full/${slug}-${i}.png`,
          thumbnail: `https://images.e2e.test/thumb/${slug}-${i}.png`,
          width: 640,
          height: 480,
          creator: "E2E Photographer",
          license: "by",
          license_version: "4.0",
          foreign_landing_url: `https://images.e2e.test/page/${slug}-${i}`,
          filetype: "png",
          title: `${q} ${i}`,
        })),
      });
    }
    if (url.pathname === "/w/api.php") {
      // Wiktionary noun tables (Articles & plurals lookup for German).
      if (url.searchParams.get("action") === "parse") {
        const NOUNS = { Hund: ["m", "Hunde"], Buch: ["n", "Bücher"], Zeitung: ["f", "Zeitungen"] };
        const n = NOUNS[url.searchParams.get("page") ?? ""];
        if (!n) return send(res, 200, { error: { code: "missingtitle" } });
        return send(res, 200, {
          parse: { wikitext: `{{Deutsch Substantiv Übersicht\n|Genus=${n[0]}\n|Nominativ Plural=${n[1]}\n}}` },
        });
      }
      // Wiktionary pronunciation lookup: only "Hund" has a recording in this mock.
      if (url.searchParams.get("generator") === "images" && (url.searchParams.get("titles") ?? "").split("|").includes("Hund")) {
        return send(res, 200, {
          query: {
            pages: {
              "-1": {
                title: "Datei:De-Hund.ogg",
                videoinfo: [
                  {
                    url: "https://upload.wikimedia.org/e2e/De-Hund.ogg",
                    derivatives: [{ src: "https://upload.wikimedia.org/e2e/De-Hund.ogg.mp3", type: "audio/mpeg" }],
                    extmetadata: { Artist: { value: "E2E Speaker" }, LicenseShortName: { value: "CC BY-SA 4.0" } },
                  },
                ],
              },
            },
          },
        });
      }
      return send(res, 200, { batchcomplete: "", query: { pages: {} } });
    }
    if (url.pathname === "/get") {
      const q = url.searchParams.get("q") ?? "";
      return send(res, 200, { responseStatus: 200, responseData: { translatedText: `meaning of ${q}` } });
    }
    if (url.pathname.endsWith(":countTokens") || url.pathname === "/v1beta/models") {
      // Key check done when a user saves their key in Settings
      if (req.headers["x-goog-api-key"] === VALID_KEY) return send(res, 200, { totalTokens: 1 });
      return send(res, 400, { error: { message: "API key not valid. Please pass a valid API key." } });
    }
    if (url.pathname.startsWith("/v1beta/models/")) {
      if (req.headers["x-goog-api-key"] !== VALID_KEY) return send(res, 403, { error: "bad key" });
      if (body.includes("vocabulary flashcards about the topic")) {
        return send(
          res,
          200,
          gemini(
            JSON.stringify([
              { term: "la cuchara", definition: "spoon", example: "Uso una cuchara." },
              { term: "el tenedor", definition: "fork", example: "El tenedor está limpio." },
              { term: "el plato", definition: "plate", example: "El plato es blanco." },
            ]),
          ),
        );
      }
      if (body.includes("responseModalities")) {
        // Gemini TTS: 0.1 s of 24 kHz 16-bit silence as base64 PCM
        const pcm = Buffer.alloc(4800).toString("base64");
        return send(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm } }] } }] });
      }
      if (body.includes("You check the grammar of")) {
        const text = JSON.parse(body).contents[0].parts[0].text;
        const items = JSON.parse(text.slice(text.indexOf("Items: ") + 7));
        return send(res, 200, gemini(JSON.stringify(items.map((c) => ({ i: c.i, article: null, plural: null })))));
      }
      if (body.includes("search keyword")) return send(res, 200, gemini('{"keyword":"object"}'));
      if (body.includes("Translate the")) return send(res, 200, gemini('{"translation":"gemini meaning","example":"Ejemplo."}'));
      return send(res, 200, gemini("ok"));
    }
    send(res, 404, { error: "not mocked", path: url.pathname });
  });
});

server.listen(PORT, () => console.log(`mock server on ${PORT}`));
