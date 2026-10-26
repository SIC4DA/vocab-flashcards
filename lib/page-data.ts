import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "./current-user";
import { getDeckDetail } from "./data";
import { ApiError } from "./api";

/** Load a deck for a page; renders the 404 page if it doesn't exist or isn't the user's. */
export async function loadDeckForPage(id: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/decks/${encodeURIComponent(id)}`);
  try {
    return { user, ...(await getDeckDetail(user.id, id)) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}
