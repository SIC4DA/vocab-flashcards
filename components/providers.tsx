"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/validation";
import { onNoVoice } from "@/lib/tts";
import { languageName } from "@/lib/languages";

/* -------------------------------- Toasts -------------------------------- */

type Toast = { id: number; message: string; kind: "info" | "success" | "error"; action?: { label: string; run: () => void } };
type ToastApi = { show: (message: string, opts?: Partial<Omit<Toast, "id" | "message">> & { durationMs?: number }) => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi["show"]>(
    (message, opts = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, message, kind: opts.kind ?? "info", action: opts.action }]);
      setTimeout(() => dismiss(id), opts.durationMs ?? (opts.action ? 6000 : 3500));
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-card ${
              t.kind === "error"
                ? "bg-danger text-white"
                : t.kind === "success"
                  ? "bg-success text-white"
                  : "bg-fg text-bg"
            }`}
            data-testid="toast"
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="min-h-11 rounded-lg px-3 font-bold underline underline-offset-2"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------------------- Confirm dialog ---------------------------- */

type ConfirmOpts = { title: string; message?: string; confirmLabel?: string; danger?: boolean };
const ConfirmContext = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  );
  useEffect(() => {
    const d = dialogRef.current;
    if (state && d && !d.open) d.showModal();
  }, [state]);
  const close = (v: boolean) => {
    state?.resolve(v);
    dialogRef.current?.close();
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <dialog
          ref={dialogRef}
          className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-line bg-surface p-6 text-fg shadow-card backdrop:bg-black/50"
          onCancel={(e) => {
            e.preventDefault();
            close(false);
          }}
          aria-labelledby="confirm-title"
        >
          <h2 id="confirm-title" className="text-lg font-bold">
            {state.title}
          </h2>
          {state.message && <p className="mt-2 text-muted">{state.message}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => close(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={state.danger ? "btn-danger" : "btn-primary"}
              onClick={() => close(true)}
              autoFocus
            >
              {state.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  );
}

/* ------------------------------ App state ------------------------------- */

export type AppUser = { id: string; username: string } | null;

type AppState = {
  user: AppUser;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  /** This user saved their own Gemini API key (AI features on). */
  gemini: boolean;
  geminiKeyHint: string | null;
  signups: boolean;
};

const AppContext = createContext<AppState>({
  user: null,
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => {},
  gemini: false,
  geminiKeyHint: null,
  signups: true,
});
export const useApp = () => useContext(AppContext);

function VoiceNotice() {
  const toast = useToast();
  useEffect(
    () =>
      onNoVoice((lang) => {
        const key = `vf-novoice-${lang}`;
        try {
          if (localStorage.getItem(key)) return;
          localStorage.setItem(key, "1");
        } catch {
          // storage unavailable — still show once per page load
        }
        toast.show(
          `Your browser has no voice for ${languageName(lang)}. Install one in OS settings, or add your Gemini API key in Settings for cloud audio.`,
          { durationMs: 8000 },
        );
      }),
    [toast],
  );
  return null;
}

export function Providers({
  children,
  user,
  settings: initialSettings,
  gemini,
  geminiKeyHint,
  signups,
}: {
  children: ReactNode;
  user: AppUser;
  settings: Settings;
  gemini: boolean;
  geminiKeyHint: string | null;
  signups: boolean;
}) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    const res = await api<{ settings: Settings }>("/api/account/settings", { method: "PATCH", body: patch });
    setSettings(res.settings);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      user,
      settings,
      updateSettings,
      gemini,
      geminiKeyHint,
      signups,
    }),
    [user, settings, updateSettings, gemini, geminiKeyHint, signups],
  );

  return (
    <AppContext.Provider value={value}>
      <ToastProvider>
        <ConfirmProvider>
          <VoiceNotice />
          {children}
        </ConfirmProvider>
      </ToastProvider>
    </AppContext.Provider>
  );
}
