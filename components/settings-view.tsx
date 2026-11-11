"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { changePasswordSchema, passwordSchema, zodFieldErrors, type Settings } from "@/lib/validation";
import { useApp, useConfirm, useToast } from "./providers";

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="cursor-pointer">
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="mt-1 h-6 w-6 shrink-0 cursor-pointer accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

function GeminiKeySection() {
  const app = useApp();
  // Shown immediately after saving/removing; the refreshed server data takes over afterwards.
  const [local, setLocal] = useState<{ gemini: boolean; hint: string | null } | null>(null);
  const gemini = local?.gemini ?? app.gemini;
  const geminiKeyHint = local ? local.hint : app.geminiKeyHint;
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveKey(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api<{ hasKey: boolean; hint: string | null }>("/api/account/gemini-key", { method: "PUT", body: { apiKey: value } });
      setLocal({ gemini: res.hasKey, hint: res.hint });
      setValue("");
      toast.show("Gemini key saved — AI features are on", { kind: "success" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? (err.fields?.apiKey ?? err.message) : "Couldn't save the key");
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    if (!(await confirm({ title: "Remove your Gemini key?", message: "AI features will turn off. Everything else keeps working.", confirmLabel: "Remove key", danger: true }))) return;
    await api("/api/account/gemini-key", { method: "DELETE" });
    setLocal({ gemini: false, hint: null });
    toast.show("Gemini key removed");
    router.refresh();
  }

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="ai-h" data-testid="gemini-section">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-h" className="mr-auto text-xl font-semibold">
          AI features (optional)
        </h2>
        <span className={`chip ${gemini ? "bg-success-soft text-success" : ""}`} data-testid="gemini-status">
          {gemini ? `Connected, key ${geminiKeyHint}` : "Not connected"}
        </span>
      </div>
      <p className="text-sm text-muted">
        The app works fully without AI. If you add your own free <b>Google Gemini API key</b>, you also get: better
        definition suggestions with an example sentence, smarter image search for non-English definitions, a cloud voice
        for words without a native recording, and
        <b> Generate deck</b> from a topic.
      </p>
      <details className="rounded-xl bg-surface-2 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">How do I get a free key? (2 minutes)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Open{" "}
            <a className="font-semibold text-accent underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
              Google AI Studio → API keys
            </a>{" "}
            and sign in with a Google account.
          </li>
          <li>
            Click <b>Create API key</b> (accept the terms if asked; pick or create any project).
          </li>
          <li>Copy the key — new keys start with <b>“AQ.”</b> (older ones with “AIza”) — paste it below, then press <b>Save key</b>.</li>
        </ol>
        <p className="mt-2 text-muted">
          The free tier is enough for personal study. Usage counts against <i>your</i> key only. Your key is checked with
          Google, stored encrypted, used only for your own requests, and never shown again.
        </p>
      </details>
      <form onSubmit={saveKey} className="space-y-2" noValidate>
        <label htmlFor="gemini-key" className="label">
          {gemini ? "Replace your key" : "Your Gemini API key"}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="gemini-key"
            type="password"
            className="input min-w-0 flex-1"
            autoComplete="off"
            spellCheck={false}
            placeholder="AQ.…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "gemini-key-error" : undefined}
          />
          <button type="submit" className="btn-primary" disabled={busy || value.trim().length === 0} data-testid="save-gemini-key">
            {busy ? "Checking…" : "Save key"}
          </button>
        </div>
        {error && (
          <p id="gemini-key-error" className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {gemini && (
        <button type="button" className="btn-ghost text-sm text-danger" onClick={removeKey} data-testid="remove-gemini-key">
          Remove key
        </button>
      )}
    </section>
  );
}

export function SettingsView() {
  const { settings, updateSettings } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [delPassword, setDelPassword] = useState("");
  const [delError, setDelError] = useState("");

  const save = async (patch: Partial<Settings>) => {
    try {
      await updateSettings(patch);
      toast.show("Settings saved", { kind: "success", durationMs: 1500 });
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Couldn't save settings", { kind: "error" });
    }
  };

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    const parsed = changePasswordSchema.safeParse(pw);
    const errs: Record<string, string> = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (pw.newPassword !== pw.confirm) errs.confirm = "Passwords don't match";
    setPwErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await api("/api/account/password", { method: "PATCH", body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      toast.show("Password changed", { kind: "success" });
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setPwErrors(err.fields);
      else toast.show("Couldn't change password", { kind: "error" });
    }
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setDelError("");
    if (!delPassword) return setDelError("Enter your password");
    if (!(await confirm({ title: "Delete your account?", message: "All your decks, cards and progress will be permanently deleted.", confirmLabel: "Delete account", danger: true }))) return;
    try {
      await api("/api/account", { method: "DELETE", body: { password: delPassword } });
      router.push("/");
      router.refresh();
    } catch (err) {
      setDelError(err instanceof ApiClientError ? err.message : "Couldn't delete account");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link href="/help" className="btn-secondary text-sm">
          How the app works
        </Link>
      </div>

      <GeminiKeySection />

      <section className="panel divide-y divide-line px-5" aria-labelledby="audio-h">
        <h2 id="audio-h" className="py-4 text-xl font-semibold">
          Audio
        </h2>
        <Toggle id="s-autoterm" label="Auto-play term audio" hint="When a card appears" checked={settings.autoPlayTerm} onChange={(v) => save({ autoPlayTerm: v })} />
        <Toggle id="s-autodef" label="Auto-play definition audio" checked={settings.autoPlayDefinition} onChange={(v) => save({ autoPlayDefinition: v })} />
        <div className="flex items-center justify-between gap-4 py-3">
          <label htmlFor="s-rate" className="font-semibold">
            Speech rate <span className="font-normal text-muted">({settings.speechRate.toFixed(1)}×)</span>
          </label>
          <input
            id="s-rate"
            type="range"
            min={0.5}
            max={1.5}
            step={0.1}
            value={settings.speechRate}
            onChange={(e) => save({ speechRate: Number(e.target.value) })}
            className="w-40 accent-[var(--accent)]"
          />
        </div>
        <Toggle id="s-sounds" label="Sound effects" hint="Short tones for right and wrong answers" checked={settings.soundEffects} onChange={(v) => save({ soundEffects: v })} />
      </section>

      <section className="panel px-5 py-4" aria-labelledby="theme-h">
        <h2 id="theme-h" className="text-xl font-semibold">
          Theme
        </h2>
        <div className="mt-3 flex gap-2" role="radiogroup" aria-labelledby="theme-h">
          {(["system", "light", "dark"] as const).map((t) => (
            <label
              key={t}
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border capitalize ${
                settings.theme === t ? "border-accent bg-accent-soft" : "border-line"
              }`}
            >
              <input type="radio" name="theme" className="sr-only" checked={settings.theme === t} onChange={() => save({ theme: t })} />
              {t}
            </label>
          ))}
        </div>
      </section>

      <form className="panel space-y-3 p-5" onSubmit={changePassword} aria-labelledby="pw-h" noValidate>
        <h2 id="pw-h" className="text-xl font-semibold">
          Change password
        </h2>
        {(
          [
            ["currentPassword", "Current password", "current-password"],
            ["newPassword", "New password", "new-password"],
            ["confirm", "Confirm new password", "new-password"],
          ] as const
        ).map(([k, label, ac]) => (
          <div key={k}>
            <label htmlFor={`pw-${k}`} className="label">
              {label}
            </label>
            <input
              id={`pw-${k}`}
              type="password"
              className="input"
              autoComplete={ac}
              value={pw[k]}
              onChange={(e) => setPw({ ...pw, [k]: e.target.value })}
              aria-invalid={Boolean(pwErrors[k])}
            />
            {pwErrors[k] && <p className="field-error">{pwErrors[k]}</p>}
          </div>
        ))}
        <p className="text-xs text-muted">{passwordSchema.description ?? "8–128 characters."}</p>
        <button type="submit" className="btn-primary">
          Change password
        </button>
      </form>

      <form className="panel space-y-3 border-danger p-5" onSubmit={deleteAccount} aria-labelledby="del-h">
        <h2 id="del-h" className="text-xl font-semibold text-danger">
          Delete account
        </h2>
        <p className="text-sm text-muted">This permanently deletes your account and all your data.</p>
        <div>
          <label htmlFor="del-password" className="label">
            Password
          </label>
          <input
            id="del-password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={delPassword}
            onChange={(e) => setDelPassword(e.target.value)}
          />
          {delError && <p className="field-error">{delError}</p>}
        </div>
        <button type="submit" className="btn-danger">
          Delete my account
        </button>
      </form>
    </div>
  );
}
