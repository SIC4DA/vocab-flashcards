"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1>Something went wrong</h1>
          <p>The app hit an unexpected error.</p>
          <button type="button" onClick={reset} style={{ padding: "12px 20px", fontSize: 16 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
