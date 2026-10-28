import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";

import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";

export function Login() {
  const { user, loading, refetch } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authConfig, setAuthConfig] = useState<{ invite_only?: boolean }>({});

  useEffect(() => {
    api<{ invite_only?: boolean }>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
        <div className="h-6 w-6 animate-spin rounded-md border-2 border-accent-action border-t-transparent" />
      </div>
    );
  }

  if (user) {
    if (redirectTo) {
      window.location.href = redirectTo;
      return null;
    }
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await api("/api/auth/login", "POST", { email, password });
      if (redirectTo) {
        window.location.href = redirectTo;
        return;
      }
      await refetch();
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.message);
          setError(parsed.detail || "Invalid credentials");
        } catch {
          setError(err.message || "Invalid credentials");
        }
      } else {
        setError("Connection error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-4">
          <CrateLogo title="Crate" className="mb-2 h-16 w-16" />
          <h1 className="text-2xl font-bold text-text-primary font-display">
            Crate
          </h1>
          <p className="-mt-0.5 text-sm text-text-muted">Own your music</p>
        </div>

        {authConfig.invite_only ? (
          <div className="rounded-md border border-accent-action/20 bg-accent-action/10 px-4 py-3 text-sm text-accent-action-hi">
            New accounts are invite-only right now. If you already have access,
            sign in below or use your social provider.
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="text-center text-sm text-state-warning-text"
          >
            {error}
          </p>
        ) : null}

        <FormField label="Email">
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </FormField>

        <FormField label="Password">
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </FormField>

        <Button
          type="submit"
          disabled={submitting}
          loading={submitting}
          className="w-full"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </Button>

        <OAuthButtons returnTo={redirectTo} />
      </form>
    </div>
  );
}
