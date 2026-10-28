import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { AuthFrame } from "./AuthFrame";

export function CredentialsForm({
  mode,
  name,
  email,
  password,
  busy,
  disabled,
  error,
  notice,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  children,
  embedded,
}: {
  mode: "login" | "register";
  name?: string;
  email: string;
  password: string;
  busy: boolean;
  disabled?: boolean;
  error?: string;
  notice?: ReactNode;
  onNameChange?: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  children?: ReactNode;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const register = mode === "register";
  return (
    <AuthFrame
      title={register ? t("auth.register.title") : "Crate"}
      subtitle={t("auth.tagline")}
      embedded={embedded}
    >
      <form onSubmit={onSubmit} className="grid gap-5">
        {notice ? (
          <div
            role="status"
            className="rounded-panel border border-border-quiet bg-surface-container p-4 text-sm text-text-muted"
          >
            {notice}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-state-danger-text">
            {error}
          </p>
        ) : null}
        {register ? (
          <FormField label={t("common.name")}>
            <Input
              name="name"
              autoComplete="name"
              value={name ?? ""}
              onChange={(e) => onNameChange?.(e.target.value)}
              required
              placeholder={t("auth.register.namePlaceholder")}
            />
          </FormField>
        ) : null}
        <FormField label={t("common.email")}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
          />
        </FormField>
        <FormField label={t("common.password")}>
          <Input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            required
            minLength={register ? 8 : undefined}
            placeholder={
              register ? t("auth.register.passwordPlaceholder") : undefined
            }
          />
        </FormField>
        <Button
          type="submit"
          loading={busy}
          disabled={busy || disabled}
          className="w-full"
        >
          {busy ? t(`auth.${mode}.submitting`) : t(`auth.${mode}.submit`)}
        </Button>
        {children}
      </form>
    </AuthFrame>
  );
}
