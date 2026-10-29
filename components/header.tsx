"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "./providers";
import { api } from "@/lib/client/api";
import { BookIcon, CardMark, GearIcon } from "./icons";

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
      // The /login render carries the fresh (logged-out) layout, so no extra refresh is needed.
      router.replace("/login");
    }
  }

  return (
    <header className={`border-b border-line bg-surface ${studying ? "hidden sm:block" : ""}`}>
      <nav className="mx-auto flex h-15 max-w-5xl items-center gap-1 px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="mr-auto flex items-center gap-2.5 text-fg">
          <CardMark />
          <span className="font-display text-xl font-semibold tracking-[-0.02em]">Vocab</span>
        </Link>
        <Link href="/help" className="btn-ghost px-3 text-sm text-muted aria-[current=page]:text-accent" aria-current={pathname === "/help" ? "page" : undefined}>
          <BookIcon size={18} />
          <span className="hidden sm:inline">Guide</span>
          <span className="sr-only sm:hidden">Guide</span>
        </Link>
        {user ? (
          <>
            <Link href="/settings" className="btn-ghost px-3 text-sm text-muted aria-[current=page]:text-accent" aria-current={pathname === "/settings" ? "page" : undefined}>
              <GearIcon size={18} />
              <span className="hidden sm:inline">Settings</span>
              <span className="sr-only sm:hidden">Settings</span>
            </Link>
            <span className="ml-2 hidden border-l border-line pl-4 text-sm text-muted md:inline" data-testid="current-user">
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
