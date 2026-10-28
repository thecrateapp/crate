import { useState, useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { CredentialsForm } from "@/components/auth/CredentialsForm";
import { api, ApiError, setAuthTokens } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { waitForPendingSecureSessionWrites } from "@/lib/server-store";

export function Register() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, loading: authLoading, refetch } = useAuth();
  const [searchParams] = useSearchParams();
  // Invite links are intentionally prefilled; the API validates the token
  // before creating an account.
  // react-doctor-disable-next-line url-prefilled-privileged-action
  const inviteToken = searchParams.get("invite") || undefined;
  const returnTo = searchParams.get("return_to") || "/";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteOnly, setInviteOnly] = useState(false);
  useEffect(() => {
    api<{ invite_only?: boolean }>("/api/auth/config")
      .then((config) => setInviteOnly(Boolean(config.invite_only)))
      .catch(() => {});
  }, []);

  if (authLoading) {
    return <CrateLoader variant="screen" label={t("common.loading")} />;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api<{
        token?: string;
        access_expires_at?: string | null;
        refresh_token?: string | null;
      }>("/api/auth/register", "POST", {
        email,
        password,
        name,
        invite_token: inviteToken,
      });
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
          setError(parsed.detail || t("auth.register.failed"));
        } catch {
          setError(err.message || t("auth.register.failed"));
        }
      } else {
        setError(t("auth.register.failed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <CredentialsForm
      mode="register"
      name={name}
      email={email}
      password={password}
      busy={loading}
      error={error}
      disabled={inviteOnly && !inviteToken}
      notice={
        inviteOnly
          ? inviteToken
            ? t("auth.register.inviteApplied")
            : t("auth.register.inviteOnly")
          : undefined
      }
      onNameChange={setName}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
    >
      <OAuthButtons returnTo={returnTo} inviteToken={inviteToken} />
      <p className="text-center text-sm text-text-muted">
        {t("auth.register.hasAccount")}{" "}
        <Link
          to={`/login?return_to=${encodeURIComponent(returnTo)}`}
          className="link-accent"
        >
          {t("auth.login.submit")}
        </Link>
      </p>
    </CredentialsForm>
  );
}
