"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Spinner } from "./ui";

export type PickedImage = { thumbUrl: string; attribution: string };
type Result = { thumbUrl: string; url: string; width: number | null; height: number | null; attribution: string };

/** Modal picker showing 8–12 Openverse/Wikimedia results for an editable query. */
export function ImagePicker({
  initialQuery,
  onPick,
  onClose,
}: {
  initialQuery: string;
  onPick: (img: PickedImage) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await api<{ results: Result[] }>(`/api/images/search?q=${encodeURIComponent(q.trim())}`);
      setResults(data.results);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Image search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    ref.current?.showModal();
    // Initial search on open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(96vw,44rem)] rounded-2xl border border-line bg-surface p-5 text-fg shadow-card backdrop:bg-black/50"
      aria-labelledby="picker-title"
    >
      <div className="flex items-center justify-between">
        <h2 id="picker-title" className="text-xl font-semibold">
          Choose an image
        </h2>
        <button type="button" className="btn-icon" aria-label="Close" onClick={() => ref.current?.close()}>
          ✕
        </button>
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <label htmlFor="picker-q" className="sr-only">
          Search images
        </label>
        <input id="picker-q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="btn-primary" disabled={loading}>
          Search
        </button>
      </form>
      <div className="mt-4 min-h-40">
        {loading && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton aspect-square" />
            ))}
            <span className="sr-only">
              <Spinner label="Searching images" />
            </span>
          </div>
        )}
        {!loading && error && <p className="text-danger">{error}</p>}
        {!loading && results && results.length === 0 && !error && (
          <p className="text-muted">No images found. Try a different word (English often works best).</p>
        )}
        {!loading && results && results.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="picker-results">
            {results.map((r) => (
              <li key={r.thumbUrl}>
                <button
                  type="button"
                  className="group block aspect-square w-full overflow-hidden rounded-xl border border-line bg-surface-2 hover:border-accent"
                  onClick={() => {
                    onPick({ thumbUrl: r.thumbUrl, attribution: r.attribution });
                    ref.current?.close();
                  }}
                  title={r.attribution}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.thumbUrl}
                    alt={r.attribution}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">Openly licensed images from Openverse and Wikimedia Commons.</p>
    </dialog>
  );
}
