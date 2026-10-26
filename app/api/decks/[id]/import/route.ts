import { ok, parseJson, requireUser, route } from "@/lib/api";
import { appendCards, getOwnedDeck } from "@/lib/data";
import { parseImport } from "@/lib/import-parser";
import { importSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Parse bulk text; returns a preview, or appends the rows when `commit` is true. */
export const POST = route(async (req, ctx: RouteContext<"/api/decks/[id]/import">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const deck = await getOwnedDeck(user.id, id);
  const { text, delimiter, commit } = await parseJson(req, importSchema);
  const parsed = parseImport(text, delimiter ?? "auto");
  if (commit) {
    await appendCards(deck.id, parsed.rows);
    return ok({ ...parsed, added: parsed.rows.length });
  }
  return ok(parsed);
});
