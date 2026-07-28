import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { api, ApiError, setAuthTokens } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { isTauriRuntime } from "@/lib/platform";
import {
  getTauriAuthDiagnostic,
  TAURI_AUTH_DIAGNOSTIC_EVENT,
  type TauriAuthDiagnostic,
} from "@/lib/tauri-auth-diagnostic";
import { waitForPendingSecureSessionWrites } from "@/lib/server-store";

export function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading: authLoading, refetch } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("return_to") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authConfig, setAuthConfig] = useState<{ invite_only?: boolean }>({});
  const [tauriAuthDiagnostic, setTauriAuthDiagnostic] =
    useState<TauriAuthDiagnostic | null>(() =>
      isTauriRuntime ? getTauriAuthDiagnostic() : null,
    );

  useEffect(() => {
    api<{ invite_only?: boolean }>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const handleDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<TauriAuthDiagnostic>).detail;
      if (detail) setTauriAuthDiagnostic(detail);
    };
    window.addEventListener(TAURI_AUTH_DIAGNOSTIC_EVENT, handleDiagnostic);
    return () => {
      window.removeEventListener(TAURI_AUTH_DIAGNOSTIC_EVENT, handleDiagnostic);
    };
  }, []);

  if (authLoading) {
    return <CrateLoader variant="screen" label={t("common.loading")} />;
  }

  if (user) {
    return <Navigate to={returnTo} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await api<{
        token?: string;
        access_expires_at?: string | null;
        refresh_token?: string | null;
      }>("/api/auth/login", "POST", { email, password });
      if (res?.token) {
        setAuthTokens(
          res.token,
          res.refresh_token ?? undefined,
          res.access_expires_at ?? undefined,
        );
        try {
          await waitForPendingSecureSessionWrites();
        } catch (error) {
          setAuthTokens(null, null, null);
          throw error;
        }
      }
      await refetch();
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.message);
          setError(parsed.detail || t("auth.login.invalidCredentials"));
        } catch {
          setError(err.message || t("auth.login.invalidCredentials"));
        }
      } else {
        setError(t("auth.login.connectionError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-4">
          <img src="/icons/logo.svg" alt="Crate" className="h-16 w-16 mb-2" />
          <h1 className="text-2xl font-bold text-white">Crate</h1>
          <p className="text-sm text-white/40 -mt-0.5">{t("auth.tagline")}</p>
        </div>

        {authConfig.invite_only ? (
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {t("auth.login.inviteOnly")}
          </div>
        ) : null}

        {error && <p className="text-sm text-red-400 text-center">{error}</p>}

        <div>
          <label htmlFor="email" className="block text-sm text-white/60 mb-1">
            {t("common.email")}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm text-white/60 mb-1"
          >
            {t("common.password")}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full h-10 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-10 rounded-lg bg-cyan-400 text-black font-medium text-sm hover:bg-cyan-300 transition-colors disabled:opacity-50"
        >
          {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
        </button>

        <OAuthButtons returnTo={returnTo} />

        {tauriAuthDiagnostic ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/45">
            <span className="text-white/65">Desktop OAuth:</span>{" "}
            {tauriAuthDiagnostic.status}
            {tauriAuthDiagnostic.detail
              ? ` · ${tauriAuthDiagnostic.detail}`
              : ""}
          </div>
        ) : null}

        <p className="text-center text-sm text-white/40">
          {t("auth.login.noAccount")}{" "}
          <Link
            to={`/register?return_to=${encodeURIComponent(returnTo)}`}
            className="text-primary hover:underline"
          >
            {t("auth.login.createOne")}
          </Link>
        </p>
      </form>
    </div>
  );
}
