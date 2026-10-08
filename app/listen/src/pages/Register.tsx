import { useState, useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { api, ApiError, setAuthTokens } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { waitForPendingSecureSessionWrites } from "@/lib/server-store";

const AUTH_INPUT_CLASS_NAME =
  "h-10 rounded-lg bg-text-primary/5 px-3 shadow-none backdrop-blur-none md:text-base";

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
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-4">
          <CrateLogo title="Crate" className="mb-2 size-16" />
          <h1 className="text-2xl font-bold text-text-primary">
            {t("auth.register.title")}
          </h1>
          <p className="text-sm text-text-primary/40 -mt-0.5">
            {t("auth.tagline")}
          </p>
        </div>

        {inviteOnly ? (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              inviteToken
                ? "border border-accent-action/20 bg-accent-action/10 text-text-accent"
                : "border border-state-warning/20 bg-state-warning/10 text-state-warning-text"
            }`}
          >
            {inviteToken
              ? t("auth.register.inviteApplied")
              : t("auth.register.inviteOnly")}
          </div>
        ) : null}

        {error && (
          <p role="alert" className="text-sm text-state-danger text-center">
            {error}
          </p>
        )}

        <FormField
          label={t("common.name")}
          className="gap-1"
          labelClassName="font-normal text-text-primary/60"
        >
          <Input
            id="reg-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={AUTH_INPUT_CLASS_NAME}
            placeholder={t("auth.register.namePlaceholder")}
          />
        </FormField>
        <FormField
          label={t("common.email")}
          className="gap-1"
          labelClassName="font-normal text-text-primary/60"
        >
          <Input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={AUTH_INPUT_CLASS_NAME}
            placeholder="you@example.com"
          />
        </FormField>
        <FormField
          label={t("common.password")}
          className="gap-1"
          labelClassName="font-normal text-text-primary/60"
        >
          <Input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className={AUTH_INPUT_CLASS_NAME}
            placeholder={t("auth.register.passwordPlaceholder")}
          />
        </FormField>

        <Button
          type="submit"
          disabled={loading || (inviteOnly && !inviteToken)}
          className="h-10 w-full rounded-lg"
        >
          {loading ? t("auth.register.submitting") : t("auth.register.submit")}
        </Button>

        <OAuthButtons returnTo={returnTo} inviteToken={inviteToken} />

        <p className="text-center text-sm text-text-primary/40">
          {t("auth.register.hasAccount")}{" "}
          <Link
            to={`/login?return_to=${encodeURIComponent(returnTo)}`}
            className="link-accent"
          >
            {t("auth.login.submit")}
          </Link>
        </p>
      </form>
    </div>
  );
}
