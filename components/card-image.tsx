"use client";

import { useState } from "react";

/** Card image with lazy loading, no-referrer, and a first-letter placeholder on failure. */
export function CardImage({
  src,
  alt,
  term,
  attribution,
  className = "",
  showAttribution = false,
}: {
  src: string | null | undefined;
  alt: string;
  term: string;
  attribution?: string | null;
  className?: string;
  showAttribution?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const ok = src && failedSrc !== src;
  return (
    <figure className={`flex flex-col items-center ${className}`}>
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element -- external, arbitrary hosts; see DECISIONS.md
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="h-full max-h-full w-full rounded-xl object-contain"
        />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="grid aspect-square h-full max-h-full place-items-center rounded-xl bg-accent-soft text-4xl font-black text-accent"
        >
          {Array.from(term.trim())[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      {showAttribution && ok && attribution && (
        <figcaption className="mt-1 line-clamp-2 max-w-full break-all text-center text-[11px] leading-tight text-muted">
          {attribution}
        </figcaption>
      )}
    </figure>
  );
}
