import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { CredentialsForm } from "@/components/auth/CredentialsForm";
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
    <CredentialsForm
      mode="login"
      email={email}
      password={password}
      busy={submitting}
      error={error}
      notice={authConfig.invite_only ? t("auth.login.inviteOnly") : undefined}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
    >
      <OAuthButtons returnTo={returnTo} />
      {tauriAuthDiagnostic ? (
        <p className="font-mono text-xs text-text-muted">
          Desktop OAuth: {tauriAuthDiagnostic.status}
          {tauriAuthDiagnostic.detail ? ` · ${tauriAuthDiagnostic.detail}` : ""}
        </p>
      ) : null}
      <p className="text-center text-sm text-text-muted">
        {t("auth.login.noAccount")}{" "}
        <Link
          to={`/register?return_to=${encodeURIComponent(returnTo)}`}
          className="link-accent"
        >
          {t("auth.login.createOne")}
        </Link>
      </p>
    </CredentialsForm>
  );
}
