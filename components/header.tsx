"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "./providers";
import { api } from "@/lib/client/api";

export function Header() {
  const { user } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const studying = pathname.includes("/study/") || pathname === "/review";

  async function logout() {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className={`border-b border-line bg-surface ${studying ? "hidden sm:block" : ""}`}>
      <nav className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="mr-auto flex items-center gap-2 text-lg font-extrabold tracking-tight text-fg">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-on-accent">
            V
          </span>
          <span>Vocab</span>
        </Link>
        <Link href="/help" className="btn-ghost px-3 text-sm" aria-current={pathname === "/help" ? "page" : undefined}>
          <span aria-hidden>📖</span>
          <span className="hidden sm:inline">Guide</span>
          <span className="sr-only sm:hidden">Guide</span>
        </Link>
        {user ? (
          <>
            <Link href="/settings" className="btn-ghost px-3 text-sm" aria-current={pathname === "/settings" ? "page" : undefined}>
              <span aria-hidden>⚙️</span>
              <span className="hidden sm:inline">Settings</span>
              <span className="sr-only sm:hidden">Settings</span>
            </Link>
            <span className="hidden text-sm text-muted md:inline" data-testid="current-user">
              {user.username}
            </span>
            <button type="button" className="btn-ghost px-3 text-sm" onClick={logout} disabled={busy}>
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="btn-ghost px-3 text-sm">
              Log in
            </Link>
            <Link href="/register" className="btn-primary px-3 text-sm">
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
