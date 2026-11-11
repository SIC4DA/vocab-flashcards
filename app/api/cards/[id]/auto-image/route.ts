import { ok, requireUser, route } from "@/lib/api";
import { autoFillImage } from "@/lib/auto-image";
import { getOwnedCard } from "@/lib/data";
import { userGeminiKey } from "@/lib/user-gemini";

export const runtime = "nodejs";
// Openverse (8 s timeout) + Wikimedia fallback (8 s) can exceed the 10 s default.
export const maxDuration = 25;

/** Find an image automatically for a card that has none. Never fails the request. */
export const POST = route(async (req, ctx: RouteContext<"/api/cards/[id]/auto-image">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { card, deck } = await getOwnedCard(user.id, id);
  const result = await autoFillImage(
    {
      id: card.id,
      definition: card.definition,
      imageUrl: card.imageUrl,
      hasUpload: card.imageData !== null,
      noImage: card.noImage,
      imageQuery: card.imageQuery,
    },
    deck.definitionLang,
    userGeminiKey(user),
  );
  return ok({ image: result });
});
