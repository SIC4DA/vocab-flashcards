import { requireUser, route } from "@/lib/api";
import { getDeckCards, getOwnedDeck } from "@/lib/data";

export const runtime = "nodejs";

function csvField(v: string | null | undefined): string {
  const s = v ?? "";
  // Prevent spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const GET = route(async (req, ctx: RouteContext<"/api/decks/[id]/export.csv">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const cards = await getDeckCards(deck.id);
  const lines = [
    ["term", "definition", "example", "image_url", "image_attribution"].join(","),
    ...cards.map((c) => [c.term, c.definition, c.example, c.imageUrl, c.imageAttribution].map(csvField).join(",")),
  ];
  const filename = `${deck.title.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "deck"}.csv`;
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deck.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
});
