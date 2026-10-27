import { eq } from "drizzle-orm";
import { ApiError, ok, requireUser, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { getOwnedCard } from "@/lib/data";
import { sniffImageType } from "@/lib/image-validate";
import { MAX_IMAGE_BYTES } from "@/lib/validation";

export const runtime = "nodejs";

type Ctx = RouteContext<"/api/cards/[id]/image">;

/** Upload an image (multipart field "file"; WebP/JPEG/PNG ≤ 150 KB, validated by magic bytes). */
export const POST = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { card } = await getOwnedCard(user.id, id);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_IMAGE_BYTES + 16 * 1024) throw new ApiError(413, "too_large", "Image must be 150 KB or smaller");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "invalid_upload", "Expected multipart form data with a file");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new ApiError(400, "invalid_upload", "Missing file");
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, "too_large", "Image must be 150 KB or smaller");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffImageType(bytes);
  if (!mime) throw new ApiError(415, "unsupported_type", "Only WebP, JPEG or PNG images are allowed");
  const db = await getDb();
  const [updated] = await db
    .update(schema.cards)
    .set({ imageData: bytes, imageMime: mime, imageUrl: null, imageAttribution: null, imageSource: "upload", noImage: false })
    .where(eq(schema.cards.id, card.id))
    .returning({ updatedAt: schema.cards.updatedAt });
  return ok({ displayImageUrl: `/api/cards/${card.id}/image?v=${updated.updatedAt.getTime()}` });
});

export const GET = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { card } = await getOwnedCard(user.id, id);
  if (!card.imageData) throw new ApiError(404, "not_found", "No uploaded image");
  const etag = `"${card.id}-${new Date(card.updatedAt).getTime()}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Type": card.imageMime ?? "image/webp",
    "X-Content-Type-Options": "nosniff",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(card.imageData), { headers });
});
