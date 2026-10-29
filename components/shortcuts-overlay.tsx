"use client";

import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/client/keys";

const SHORTCUTS: [string, string][] = [
  ["Space", "Flip card / play audio"],
  ["P", "Play audio"],
  ["Enter", "Submit / continue"],
  ["← / →", "Still learning / know it (flashcards)"],
  ["1 – 4", "Choose a multiple-choice option"],
  ["Esc", "Exit the session"],
  ["?", "Show this list"],
];

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => setOpen(false)}
      className="m-auto w-[min(92vw,24rem)] rounded-2xl border border-line bg-surface p-6 text-fg shadow-card backdrop:bg-black/50"
      aria-labelledby="shortcuts-title"
    >
      <h2 id="shortcuts-title" className="text-xl font-semibold">
        Keyboard shortcuts
      </h2>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs">{k}</kbd>
            </dt>
            <dd className="text-muted">{d}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted">Shortcuts other than Enter are ignored while typing in a field.</p>
      <div className="mt-4 flex justify-end">
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </dialog>
  );
}
