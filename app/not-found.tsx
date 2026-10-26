import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-12 max-w-md text-center" data-testid="not-found">
      <p aria-hidden className="text-6xl">
        🧭
      </p>
      <h1 className="mt-4 text-3xl font-black">Page not found</h1>
      <p className="mt-2 text-muted">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className="btn-primary mt-6">
        Go to your decks
      </Link>
    </div>
  );
}
