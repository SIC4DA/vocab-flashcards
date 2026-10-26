"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-12 max-w-md text-center" role="alert">
      <p aria-hidden className="text-6xl">
        😵
      </p>
      <h1 className="mt-4 text-3xl font-black">Something went wrong</h1>
      <p className="mt-2 text-muted">An unexpected error happened. Your progress is saved after every answer.</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" className="btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
