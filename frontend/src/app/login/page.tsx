"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";
import { login, AuthError } from "@/lib/auth";
import { isValidInternalRedirect } from "@/lib/authRoutes";

function LoginForm() {
  const searchParams = useSearchParams();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  const usernameInputRef = useRef<HTMLInputElement | null>(null);

  // Focus username input on mount
  useEffect(() => {
    usernameInputRef.current?.focus();
  }, []);

  // Countdown timer for 429 rate-limited responses
  useEffect(() => {
    if (countdownSeconds === null || countdownSeconds <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdownSeconds]);

  const formatCountdown = (totalSec: number): string => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins > 0) {
      return `${mins} min ${secs.toString().padStart(2, "0")} s`;
    }
    return `${secs} s`;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || (countdownSeconds !== null && countdownSeconds > 0)) {
      return;
    }

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setErrorMessage("Por favor introduce usuario y contraseña.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await login(trimmedUser, password);

      // On success, full navigation so entire state re-initializes with session cookie
      const rawNext = searchParams.get("next");
      const targetRoute =
        rawNext && isValidInternalRedirect(rawNext) && rawNext !== "/login"
          ? rawNext
          : "/";

      if (typeof window !== "undefined") {
        if (typeof window.location?.replace === "function") {
          window.location.replace(targetRoute);
        } else {
          window.location.href = targetRoute;
        }
      }
    } catch (err: unknown) {
      setSubmitting(false);

      if (err instanceof AuthError) {
        if (err.status === 429 && err.retryAfterS) {
          const secs = Math.ceil(err.retryAfterS);
          setCountdownSeconds(secs);
          setErrorMessage(err.detail);
        } else {
          setErrorMessage(err.detail || "Usuario o contraseña incorrectos.");
        }
      } else if (err instanceof Error) {
        setErrorMessage(err.message || "Error al iniciar sesión.");
      } else {
        setErrorMessage("Error de conexión. Intenta de nuevo.");
      }
    }
  };

  const isFormDisabled = submitting || (countdownSeconds !== null && countdownSeconds > 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary-soft/20 flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 [@media(orientation:landscape)_and_(max-height:540px)]:p-2 [@media(orientation:landscape)_and_(max-height:540px)]:py-1.5">
      {/* Login Card */}
      <div className="w-full max-w-[420px] [@media(orientation:landscape)_and_(max-height:540px)]:max-w-[580px] rounded-2xl border border-border bg-card p-6 sm:p-8 [@media(orientation:landscape)_and_(max-height:540px)]:p-3.5 shadow-xl space-y-6 [@media(orientation:landscape)_and_(max-height:540px)]:space-y-2">
        {/* Main content: single column in portrait/desktop, 2 columns in compact landscape */}
        <div className="space-y-6 [@media(orientation:landscape)_and_(max-height:540px)]:space-y-0 [@media(orientation:landscape)_and_(max-height:540px)]:grid [@media(orientation:landscape)_and_(max-height:540px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:540px)]:gap-4 [@media(orientation:landscape)_and_(max-height:540px)]:items-center">
          {/* Column 1 (Left): Logo, Lockup, and Subtitle */}
          <div className="text-center [@media(orientation:landscape)_and_(max-height:540px)]:text-left space-y-2 [@media(orientation:landscape)_and_(max-height:540px)]:space-y-1">
            <div className="flex justify-center [@media(orientation:landscape)_and_(max-height:540px)]:justify-start mb-1 [@media(orientation:landscape)_and_(max-height:540px)]:mb-0.5">
              <BrandMark size={44} className="[@media(orientation:landscape)_and_(max-height:540px)]:size-8" />
            </div>
            <div className="font-display font-extrabold text-2xl [@media(orientation:landscape)_and_(max-height:540px)]:text-lg tracking-tight text-ink flex items-baseline justify-center [@media(orientation:landscape)_and_(max-height:540px)]:justify-start gap-1.5">
              <span>Atalaya</span>
              <span className="text-primary font-bold">Electoral</span>
            </div>
            <p className="text-xs [@media(orientation:landscape)_and_(max-height:540px)]:text-[11px] text-muted-foreground leading-relaxed">
              Riesgo de abstención · Elección federal 2027
            </p>
          </div>

          {/* Column 2 (Right): Error Alert & Form */}
          <div className="space-y-4 [@media(orientation:landscape)_and_(max-height:540px)]:space-y-2">
            {/* Error message / alert with aria-live */}
            {errorMessage && (
              <div
                role="alert"
                aria-live="assertive"
                className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 [@media(orientation:landscape)_and_(max-height:540px)]:p-1.5 text-xs text-destructive space-y-1"
              >
                <div className="flex items-start gap-2">
                  <span className="text-base [@media(orientation:landscape)_and_(max-height:540px)]:text-xs leading-none shrink-0" aria-hidden="true">
                    ⚠️
                  </span>
                  <div className="font-medium leading-relaxed flex-1 [@media(orientation:landscape)_and_(max-height:540px)]:text-[11px]">
                    {errorMessage}
                  </div>
                </div>
                {countdownSeconds !== null && countdownSeconds > 0 && (
                  <div className="text-[11px] font-mono text-muted-foreground pl-6 [@media(orientation:landscape)_and_(max-height:540px)]:pl-4 [@media(orientation:landscape)_and_(max-height:540px)]:text-[10px]">
                    Espera activa:{" "}
                    <span className="font-bold text-destructive">
                      {formatCountdown(countdownSeconds)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-4 [@media(orientation:landscape)_and_(max-height:540px)]:space-y-1.5" noValidate>
              {/* Username Field */}
              <div className="space-y-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:space-y-0.5">
                <label
                  htmlFor="username"
                  className="block text-xs font-semibold text-foreground [@media(orientation:landscape)_and_(max-height:540px)]:text-[11px]"
                >
                  Usuario institucional
                </label>
                <input
                  ref={usernameInputRef}
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  required
                  disabled={submitting}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="nombre.usuario"
                  className="w-full h-10 [@media(orientation:landscape)_and_(max-height:540px)]:h-8 px-3 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-60"
                />
              </div>

              {/* Password Field with Show/Hide Toggle */}
              <div className="space-y-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:space-y-0.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-xs font-semibold text-foreground [@media(orientation:landscape)_and_(max-height:540px)]:text-[11px]"
                  >
                    Contraseña
                  </label>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    disabled={submitting}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full h-10 [@media(orientation:landscape)_and_(max-height:540px)]:h-8 pl-3 pr-10 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    disabled={submitting}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded cursor-pointer"
                  >
                    {showPassword ? (
                      <svg
                        className="size-4 [@media(orientation:landscape)_and_(max-height:540px)]:size-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="size-4 [@media(orientation:landscape)_and_(max-height:540px)]:size-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2 [@media(orientation:landscape)_and_(max-height:540px)]:pt-0.5">
                <button
                  type="submit"
                  disabled={isFormDisabled}
                  className="w-full h-10 [@media(orientation:landscape)_and_(max-height:540px)]:h-8 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <svg
                        className="animate-spin size-4 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                      <span>Iniciando sesión...</span>
                    </>
                  ) : countdownSeconds !== null && countdownSeconds > 0 ? (
                    <span>Reintentar en {formatCountdown(countdownSeconds)}</span>
                  ) : (
                    <span>Entrar</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Legal Disclaimer / Footer */}
        <div className="pt-2 border-t border-border/80 text-center [@media(orientation:landscape)_and_(max-height:540px)]:pt-1.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed [@media(orientation:landscape)_and_(max-height:540px)]:text-[10px]">
            Propuesta del equipo OXENT · Hackathon INE 2026. Acceso restringido al personal autorizado; los intentos se registran.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary-soft/20 flex flex-col justify-center items-center p-4">
          <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-8 shadow-xl animate-pulse space-y-4">
            <div className="size-12 rounded-full bg-muted mx-auto" />
            <div className="h-6 w-32 bg-muted mx-auto rounded" />
            <div className="h-4 w-48 bg-muted mx-auto rounded" />
            <div className="h-10 bg-muted rounded mt-6" />
            <div className="h-10 bg-muted rounded" />
            <div className="h-10 bg-muted rounded mt-4" />
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
