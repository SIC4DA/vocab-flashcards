"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { loginSchema, registerFormSchema, zodFieldErrors } from "@/lib/validation";

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function AuthForm({ mode, next, signups }: { mode: "login" | "register"; next?: string; signups: boolean }) {
  const [values, setValues] = useState({ username: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const parsed = isRegister ? registerFormSchema.safeParse(values) : loginSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, { body: { username: values.username, password: values.password } });
      // Full navigation so the server layout picks up the new session.
      window.location.assign(safeNext(next));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiClientError) {
        if (err.fields) setErrors(err.fields);
        setFormError(err.fields?.username && isRegister ? "" : err.message);
      } else setFormError("Something went wrong. Please try again.");
    }
  }

  if (isRegister && !signups) {
    return (
      <div className="index-card mx-auto mt-10 max-w-md px-6 pb-8 pt-5 text-center">
        <h1 className="text-2xl font-semibold">Sign-ups are closed</h1>
        <p className="mt-2 text-muted">The owner of this app has disabled new registrations.</p>
        <Link href="/login" className="btn-primary mt-6">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-md sm:mt-12">
      <form onSubmit={submit} noValidate className="index-card px-6 pb-8 pt-5 sm:px-8" aria-describedby={formError ? "form-error" : undefined}>
        <h1 className="text-[1.9rem] font-semibold">{isRegister ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-muted">{isRegister ? "Just a username and a password — no email needed." : "Log in to keep learning."}</p>

        {formError && (
          <p id="form-error" role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="username" className="label">
              Username
            </label>
            <input
              id="username"
              name="username"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={values.username}
              onChange={set("username")}
              aria-invalid={Boolean(errors.username)}
              aria-describedby={errors.username ? "username-error" : isRegister ? "username-hint" : undefined}
            />
            {errors.username ? (
              <p id="username-error" className="field-error">
                {errors.username}
              </p>
            ) : (
              isRegister && (
                <p id="username-hint" className="mt-1 text-xs text-muted">
                  3–20 characters: letters, numbers and _
                </p>
              )
            )}
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={values.password}
              onChange={set("password")}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "password-error" : undefined}
            />
            {errors.password && (
              <p id="password-error" className="field-error">
                {errors.password}
              </p>
            )}
          </div>
          {isRegister && (
            <div>
              <label htmlFor="confirmPassword" className="label">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                className="input"
                autoComplete="new-password"
                value={values.confirmPassword}
                onChange={set("confirmPassword")}
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={errors.confirmPassword ? "confirm-error" : undefined}
              />
              {errors.confirmPassword && (
                <p id="confirm-error" className="field-error">
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          )}
        </div>

        <button type="submit" className="btn-primary mt-6 w-full" disabled={busy}>
          {busy ? "Please wait…" : isRegister ? "Sign up" : "Log in"}
        </button>
        <p className="mt-4 text-center text-sm text-muted">
          {isRegister ? (
            <>
              Already have an account?{" "}
              <Link className="font-semibold text-accent underline" href="/login">
                Log in
              </Link>
            </>
          ) : signups ? (
            <>
              New here?{" "}
              <Link className="font-semibold text-accent underline" href="/register">
                Create an account
              </Link>
            </>
          ) : null}
        </p>
      </form>
    </div>
  );
}
