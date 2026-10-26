import { ApiError, ok, requireUser, route } from "@/lib/api";
import { searchImages } from "@/lib/images";

export const runtime = "nodejs";
export const maxDuration = 25;

export const GET = route(async (req) => {
  await requireUser(req);
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) throw new ApiError(400, "validation_error", "Missing search query");
  if (q.length > 100) throw new ApiError(400, "validation_error", "Query is too long");
  const results = await searchImages(q, 12);
  return ok({ results: results.map(({ thumbUrl, url, width, height, attribution }) => ({ thumbUrl, url, width, height, attribution })) });
});
