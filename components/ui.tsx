"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGES, getLanguage } from "@/lib/languages";

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1 flex-1 overflow-hidden bg-rule"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label ?? "Progress"}
      >
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="min-w-14 text-right text-sm font-semibold tabular-nums text-muted" data-testid="progress-text">
        {value} / {max}
      </span>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

/** Searchable language dropdown (combobox). */
export function LanguageSelect({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = getLanguage(value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? LANGUAGES.filter((l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)) : LANGUAGES;
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        className="input"
        value={open ? query : `${current.flag} ${current.name}`}
        placeholder="Search languages…"
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(filtered.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (filtered[active]) choose(filtered[active].code);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-card"
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-muted">No match</li>}
          {filtered.map((l, i) => (
            <li
              key={l.code}
              role="option"
              aria-selected={l.code === value}
              className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm ${
                i === active ? "bg-accent-soft" : ""
              } ${l.code === value ? "font-bold" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(l.code);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span aria-hidden>{l.flag}</span>
              {l.name}
              <span className="ml-auto text-xs text-muted">{l.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** On-screen special-characters bar; inserts at the cursor of the given input. */
export function SpecialCharsBar({
  lang,
  inputRef,
  onInsert,
}: {
  lang: string;
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  onInsert: (value: string) => void;
}) {
  const chars = getLanguage(lang).specialChars;
  if (!chars?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Special characters">
      {chars.map((ch) => (
        <button
          key={ch}
          type="button"
          className="min-h-11 min-w-11 rounded-lg border border-line bg-surface text-lg font-medium hover:bg-surface-2"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const el = inputRef.current;
            if (!el) return;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;
            const next = el.value.slice(0, start) + ch + el.value.slice(end);
            onInsert(next);
            requestAnimationFrame(() => {
              el.focus();
              const pos = start + ch.length;
              el.setSelectionRange(pos, pos);
            });
          }}
          aria-label={`Insert ${ch}`}
        >
          {ch}
        </button>
      ))}
    </div>
  );
}

export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 10) * 0.12,
        color: ["var(--accent)", "var(--success)", "var(--warning)", "var(--danger)"][i % 4],
      })),
    [],
  );
  return (
    <div aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, background: p.color }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="index-card mx-auto flex max-w-xl flex-col items-center px-6 pb-10 pt-8 text-center">
      <h2 className="headword text-2xl leading-8">{title}</h2>
      <div className="mt-2 max-w-md text-muted">{children}</div>
    </div>
  );
}
