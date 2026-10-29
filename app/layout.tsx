import type { Metadata, Viewport } from "next";
import { Literata, Noto_Sans, Noto_Sans_Arabic, Noto_Sans_Hebrew, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { getCurrentUser } from "@/lib/current-user";
import { signupsAllowed } from "@/lib/env";
import { DEFAULT_SETTINGS } from "@/lib/validation";

// Interface text.
// Only the basic Latin files are loaded (covers German, French, Spanish…); other scripts fall back to Noto.
const ui = Schibsted_Grotesk({ variable: "--font-ui", subsets: ["latin"], display: "swap" });
// Headwords, deck titles and headings (dictionary character).
const headword = Literata({ variable: "--font-headword", subsets: ["latin"], weight: ["500", "600"], display: "swap" });

const noto = Noto_Sans({
  variable: "--font-noto",
  subsets: ["latin", "latin-ext", "cyrillic", "greek", "vietnamese"],
  display: "swap",
  preload: false,
});
const notoArabic = Noto_Sans_Arabic({ variable: "--font-noto-arabic", subsets: ["arabic"], display: "swap", preload: false });
const notoHebrew = Noto_Sans_Hebrew({ variable: "--font-noto-hebrew", subsets: ["hebrew"], display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "Vocab Flashcards", template: "%s · Vocab Flashcards" },
  description: "Learn vocabulary with flashcards, spaced repetition, listening and writing practice.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#121a2c" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  const settings = user?.settings ?? DEFAULT_SETTINGS;
  return (
    <html
      lang="en"
      data-theme={settings.theme}
      className={`${ui.variable} ${headword.variable} ${noto.variable} ${notoArabic.variable} ${notoHebrew.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only-focusable btn-primary fixed left-2 top-2 z-50">
          Skip to content
        </a>
        <Providers
          user={user ? { id: user.id, username: user.username } : null}
          settings={settings}
          gemini={Boolean(user?.hasGeminiKey)}
          geminiKeyHint={user?.geminiKeyHint ?? null}
          signups={signupsAllowed()}
        >
          <Header />
          <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-4 sm:px-6">
            {children}
          </main>
          <ShortcutsOverlay />
        </Providers>
      </body>
    </html>
  );
}
