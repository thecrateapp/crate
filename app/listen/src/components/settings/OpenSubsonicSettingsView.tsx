import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { FormField } from "@crate/ui/primitives/FormField";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { ErrorState } from "@crate/ui/domain/states";
import { Button } from "@crate/ui/shadcn/button";
import { Section } from "./SettingsPrimitives";

export type CredentialAction = "rotate" | "revoke";
export type CredentialNotice = "created" | "copied" | "hidden";
export type CredentialError = "copy" | "operation";
export function OpenSubsonicSettingsView({
  ruled,
  configured,
  loading,
  loadError,
  secret,
  notice,
  error,
  busy,
  confirmOpen,
  confirmingAction,
  onRetry,
  onCreate,
  onCopy,
  onHide,
  onRequestConfirmation,
  onConfirm,
  onConfirmOpenChange,
}: {
  ruled?: boolean;
  configured: boolean | null;
  loading: boolean;
  loadError: boolean;
  secret: string | null;
  notice: CredentialNotice | null;
  error: CredentialError | null;
  busy: boolean;
  confirmOpen: boolean;
  confirmingAction: CredentialAction;
  onRetry: () => void;
  onCreate: () => void;
  onCopy: () => void;
  onHide: () => void;
  onRequestConfirmation: (action: CredentialAction) => void;
  onConfirm: () => void | Promise<void>;
  onConfirmOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section
      ruled={ruled}
      title={t("settings.openSubsonic.title")}
      description={t("settings.openSubsonic.description")}
    >
      {loading ? (
        <p role="status" className="text-caption text-text-muted">
          {t("settings.openSubsonic.loading")}
        </p>
      ) : loadError ? (
        <ErrorState
          message={t("settings.openSubsonic.loadError")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
        />
      ) : (
        <>
          <StatusDot
            tone={configured ? "on" : "off"}
            label={t(
              configured
                ? "settings.openSubsonic.configured"
                : "settings.openSubsonic.notConfigured",
            )}
          />
          <div className="grid min-w-0 gap-5 @min-[36rem]:grid-cols-2">
            <FormField
              kind="group"
              label={t("settings.openSubsonic.apiKeyTitle")}
            >
              {(field) => (
                <div
                  {...field}
                  role="group"
                  className="text-caption text-text-muted"
                >
                  {t("settings.openSubsonic.apiKeyDescription")}
                </div>
              )}
            </FormField>
            <FormField
              kind="group"
              label={t("settings.openSubsonic.legacyTitle")}
            >
              {(field) => (
                <div
                  {...field}
                  role="group"
                  className="grid gap-2 text-caption text-text-muted"
                >
                  <p>{t("settings.openSubsonic.legacyDescription")}</p>
                  <p>{t("settings.openSubsonic.passwordWarning")}</p>
                </div>
              )}
            </FormField>
          </div>
          {error ? (
            <p role="alert" className="text-caption text-state-danger-text">
              {t(
                error === "copy"
                  ? "settings.openSubsonic.copyError"
                  : "settings.openSubsonic.operationError",
              )}
            </p>
          ) : null}
          {busy ? (
            <p role="status" className="text-caption text-text-muted">
              {t("common.working")}
            </p>
          ) : null}
          {secret ? (
            <div className="grid min-w-0 gap-3">
              <FormField
                kind="group"
                label={t("settings.openSubsonic.keyValue")}
                hint={t("settings.openSubsonic.secretCreated")}
              >
                {(field) => (
                  <code
                    {...field}
                    role="group"
                    className="block select-all wrap-anywhere font-mono text-sm text-text-primary"
                  >
                    {secret}
                  </code>
                )}
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={onCopy}>
                  {t("settings.openSubsonic.copyKey")}
                </Button>
                <Button variant="outline" disabled={busy} onClick={onHide}>
                  {t("settings.openSubsonic.hideKey")}
                </Button>
              </div>
            </div>
          ) : null}
          {notice && !secret ? (
            <p role="status" className="text-caption text-text-accent">
              {notice === "copied"
                ? t("settings.openSubsonic.secretCopied")
                : notice === "hidden"
                  ? t("settings.openSubsonic.secretHidden")
                  : null}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {configured ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => onRequestConfirmation("rotate")}
                >
                  {t("settings.openSubsonic.rotateKey")}
                </Button>
                <Button
                  variant="danger-soft"
                  disabled={busy}
                  onClick={() => onRequestConfirmation("revoke")}
                >
                  {t("settings.openSubsonic.revokeKey")}
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={onCreate}>
                {t("settings.openSubsonic.createKey")}
              </Button>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        eyebrow={t("actions.confirmation.eyebrow")}
        open={confirmOpen}
        onOpenChange={onConfirmOpenChange}
        onConfirm={onConfirm}
        tone={confirmingAction === "revoke" ? "danger" : "default"}
        title={t(`settings.openSubsonic.${confirmingAction}ConfirmTitle`)}
        description={t(
          `settings.openSubsonic.${confirmingAction}ConfirmDescription`,
        )}
        confirmLabel={t(
          `settings.openSubsonic.${confirmingAction}ConfirmAction`,
        )}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        ariaLabel={t(`settings.openSubsonic.${confirmingAction}ConfirmTitle`)}
        backdropLabel={t("common.close")}
      />
    </Section>
  );
}
