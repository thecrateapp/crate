import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";

const MIN_PASSWORD_LENGTH = 8;

function apiErrorDetail(err: unknown): string {
  if (!(err instanceof ApiError)) return "Connection error";
  try {
    const parsed = JSON.parse(err.message) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    return err.message || "Could not change the password";
  }
  return "Could not change the password";
}

export function PasswordChangeRequired() {
  const { user, refetch, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a password different from the initial one.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await api("/api/me/password", "PUT", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success("Password changed");
      await refetch();
    } catch (err) {
      setError(apiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-surface px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-4 text-center">
          <CrateLogo title="Crate" className="mb-2 h-16 w-16" />
          <h1 className="text-2xl font-bold text-text-primary font-display">
            Choose a new password
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {user?.email} was created with an initial password. Set your own
            password to continue.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="text-center text-sm text-state-warning-text"
          >
            {error}
          </p>
        ) : null}

        <FormField label="Current password">
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </FormField>

        <FormField label="New password">
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </FormField>

        <FormField label="Confirm new password">
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </FormField>

        <Button
          type="submit"
          disabled={submitting}
          loading={submitting}
          className="w-full"
        >
          {submitting ? "Saving..." : "Save password"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => logout()}
        >
          Sign out
        </Button>
      </form>
    </div>
  );
}
