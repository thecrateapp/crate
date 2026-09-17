import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@crate/ui/shadcn/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@crate/ui/shadcn/alert-dialog";

import { Section } from "@/components/settings/SettingsPrimitives";
import { api } from "@/lib/api";

const CREDENTIAL_URL = "/api/auth/subsonic-token";

interface CredentialStatus {
  configured: boolean;
}

interface CreatedCredential {
  api_key: string;
}

type ConfirmedAction = "rotate" | "revoke";
type Notice = "created" | "copied" | "hidden";
type RequestError = "copy" | "operation";

export function OpenSubsonicCredentialsSection() {
  const { t } = useTranslation();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [secret, setSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [busy, setBusy] = useState(false);
  const copyInProgress = useRef(false);
  const [confirmingAction, setConfirmingAction] =
    useState<ConfirmedAction | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);

    api<CredentialStatus>(CREDENTIAL_URL)
      .then((response) => {
        if (active) setConfigured(response.configured);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshAttempt]);

  async function createCredential() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api<CreatedCredential>(CREDENTIAL_URL, "POST");
      if (!response.api_key) throw new Error("Missing OpenSubsonic key");
      setConfigured(true);
      setSecret(response.api_key);
      setNotice("created");
    } catch {
      setError("operation");
    } finally {
      setBusy(false);
    }
  }

  async function revokeCredential() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(CREDENTIAL_URL, "DELETE");
      setConfigured(false);
      setSecret(null);
    } catch {
      setError("operation");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction() {
    const action = confirmingAction;
    setConfirmingAction(null);
    if (action === "rotate") {
      await createCredential();
    } else if (action === "revoke") {
      await revokeCredential();
    }
  }

  async function copyCredential() {
    if (!secret || copyInProgress.current) return;
    copyInProgress.current = true;
    setError(null);
    try {
      await navigator.clipboard.writeText(secret);
      setSecret(null);
      setNotice("copied");
    } catch {
      setError("copy");
    } finally {
      copyInProgress.current = false;
    }
  }

  const isPending = loading;

  return (
    <Section
      title={t("settings.openSubsonic.title")}
      description={t("settings.openSubsonic.description")}
    >
      {isPending ? (
        <p role="status" className="text-sm text-text-muted">
          {t("settings.openSubsonic.loading")}
        </p>
      ) : loadError ? (
        <div
          role="alert"
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-sm text-state-danger-text">
            {t("settings.openSubsonic.loadError")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRefreshAttempt((attempt) => attempt + 1)}
          >
            {t("settings.openSubsonic.retry")}
          </Button>
        </div>
      ) : (
        <>
          <div
            className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
              configured
                ? "border-state-success/30 bg-state-success/10 text-state-success"
                : "border-border-quiet bg-surface-container text-text-muted"
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${
                configured ? "bg-state-success" : "bg-text-muted/60"
              }`}
            />
            {configured
              ? t("settings.openSubsonic.configured")
              : t("settings.openSubsonic.notConfigured")}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border-quiet bg-surface-container p-4">
              <h3 className="text-sm font-medium text-text-primary">
                {t("settings.openSubsonic.apiKeyTitle")}
              </h3>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t("settings.openSubsonic.apiKeyDescription")}
              </p>
            </div>
            <div className="rounded-xl border border-border-quiet bg-surface-container p-4">
              <h3 className="text-sm font-medium text-text-primary">
                {t("settings.openSubsonic.legacyTitle")}
              </h3>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t("settings.openSubsonic.legacyDescription")}
              </p>
              <p className="mt-2 text-xs font-medium text-text-primary/80">
                {t("settings.openSubsonic.passwordWarning")}
              </p>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-state-danger-text">
              {error === "copy"
                ? t("settings.openSubsonic.copyError")
                : t("settings.openSubsonic.operationError")}
            </p>
          ) : null}

          {busy ? (
            <p role="status" className="text-sm text-text-muted">
              {t("common.working")}
            </p>
          ) : null}

          {secret ? (
            <div className="space-y-3 rounded-xl border border-accent-action/30 bg-accent-action/5 p-4">
              <p className="text-sm font-medium text-text-primary">
                {t("settings.openSubsonic.secretCreated")}
              </p>
              <code className="block select-all break-all rounded-lg border border-border-quiet bg-surface-canvas px-3 py-2 font-mono text-sm text-text-primary">
                {secret}
              </code>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void copyCredential()}
                  className="w-full sm:w-auto"
                >
                  {t("settings.openSubsonic.copyKey")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setSecret(null);
                    setNotice("hidden");
                    setError(null);
                  }}
                  className="w-full sm:w-auto"
                >
                  {t("settings.openSubsonic.hideKey")}
                </Button>
              </div>
            </div>
          ) : null}

          {notice && !secret ? (
            <p role="status" className="text-sm text-text-accent">
              {notice === "copied"
                ? t("settings.openSubsonic.secretCopied")
                : notice === "hidden"
                  ? t("settings.openSubsonic.secretHidden")
                  : null}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            {configured ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmingAction("rotate")}
                  className="w-full sm:w-auto"
                >
                  {t("settings.openSubsonic.rotateKey")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setConfirmingAction("revoke")}
                  className="w-full sm:w-auto"
                >
                  {t("settings.openSubsonic.revokeKey")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void createCredential()}
                className="w-full sm:w-auto"
              >
                {t("settings.openSubsonic.createKey")}
              </Button>
            )}
          </div>
        </>
      )}

      <AlertDialog
        open={confirmingAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingAction(null);
        }}
      >
        <AlertDialogContent className="border-border-subtle bg-surface-container">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmingAction === "rotate"
                ? t("settings.openSubsonic.rotateConfirmTitle")
                : t("settings.openSubsonic.revokeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingAction === "rotate"
                ? t("settings.openSubsonic.rotateConfirmDescription")
                : t("settings.openSubsonic.revokeConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmAction()}
              className={
                confirmingAction === "revoke"
                  ? "bg-state-danger text-state-danger-foreground hover:bg-state-danger/90"
                  : ""
              }
            >
              {confirmingAction === "rotate"
                ? t("settings.openSubsonic.rotateConfirmAction")
                : t("settings.openSubsonic.revokeConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
