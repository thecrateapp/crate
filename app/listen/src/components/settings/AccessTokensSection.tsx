import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { Section, ToggleRow } from "@/components/settings/SettingsPrimitives";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { SERVER_STORE_EVENT } from "@/lib/server-store";

const TOKENS_URL = "/api/auth/access-tokens";

const SCOPE_LABEL_KEYS: Record<string, string> = {
  "vdj.catalog.read": "settings.accessTokens.scopes.catalog",
  "vdj.media.read": "settings.accessTokens.scopes.media",
  "vdj.smart_mix.read": "settings.accessTokens.scopes.smartMix",
  "vdj.play_events.write": "settings.accessTokens.scopes.playEvents",
  "vdj.automation.execute": "settings.accessTokens.scopes.automation",
  "vdj.automation": "settings.accessTokens.scopes.legacyAutomation",
};

const SELECTABLE_SCOPE_OPTIONS = [
  {
    scope: "vdj.catalog.read",
    labelKey: "settings.accessTokens.scopes.catalog",
  },
  { scope: "vdj.media.read", labelKey: "settings.accessTokens.scopes.media" },
  {
    scope: "vdj.smart_mix.read",
    labelKey: "settings.accessTokens.scopes.smartMix",
  },
  {
    scope: "vdj.play_events.write",
    labelKey: "settings.accessTokens.scopes.playEvents",
  },
  {
    scope: "vdj.automation.execute",
    labelKey: "settings.accessTokens.scopes.automation",
  },
];

const SELECTABLE_SCOPES = SELECTABLE_SCOPE_OPTIONS.map(
  (option) => option.scope,
);

const DEFAULT_SCOPES = SELECTABLE_SCOPES.filter(
  (scope) => scope !== "vdj.automation.execute",
);

const EXPIRY_OPTIONS: { days: number | null; labelKey: string }[] = [
  { days: null, labelKey: "settings.accessTokens.expiry.never" },
  { days: 30, labelKey: "settings.accessTokens.expiry.days30" },
  { days: 90, labelKey: "settings.accessTokens.expiry.days90" },
  { days: 365, labelKey: "settings.accessTokens.expiry.year" },
];

interface AccessToken {
  id: number;
  name: string;
  token_prefix: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
  token?: string | null;
}

interface PendingAction {
  kind: "rotate" | "revoke";
  token: AccessToken;
}

type RequestError = "load" | "create" | "rotate" | "revoke" | "copy";

export function AccessTokensSection() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const nameId = useId();
  const [tokens, setTokens] = useState<AccessToken[] | null>(null);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const copyInProgress = useRef(false);

  useEffect(() => {
    let active = true;
    setError(null);
    api<AccessToken[]>(TOKENS_URL)
      .then((response) => {
        if (active) setTokens(response);
      })
      .catch(() => {
        if (active) setError("load");
      });
    return () => {
      active = false;
    };
  }, [refreshAttempt, user?.id]);

  useEffect(() => {
    setSecret(null);
  }, [user?.id]);

  useEffect(() => {
    function forgetSecret() {
      setSecret(null);
      setRefreshAttempt((attempt) => attempt + 1);
    }
    window.addEventListener(SERVER_STORE_EVENT, forgetSecret);
    return () => window.removeEventListener(SERVER_STORE_EVENT, forgetSecret);
  }, []);

  const activeTokens = (tokens ?? []).filter((token) => !token.revoked_at);
  const canCreate = name.trim().length > 0 && scopes.length > 0 && !busy;

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
    }).format(new Date(value));
  }

  function toggleScope(scope: string, enabled: boolean) {
    setScopes((current) =>
      enabled
        ? SELECTABLE_SCOPES.filter(
            (candidate) => candidate === scope || current.includes(candidate),
          )
        : current.filter((candidate) => candidate !== scope),
    );
  }

  function resetForm() {
    setFormOpen(false);
    setName("");
    setScopes(DEFAULT_SCOPES);
    setExpiresInDays(null);
  }

  async function createToken() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<AccessToken>(TOKENS_URL, "POST", {
        name: name.trim(),
        scopes,
        expires_in_days: expiresInDays,
      });
      setSecret(created.token ?? null);
      setTokens((current) => [{ ...created, token: null }, ...(current ?? [])]);
      resetForm();
    } catch {
      setError("create");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    const { kind, token } = pending;
    setBusy(true);
    setError(null);
    try {
      if (kind === "rotate") {
        const rotated = await api<AccessToken>(
          `${TOKENS_URL}/${token.id}/rotate`,
          "POST",
        );
        setSecret(rotated.token ?? null);
        setTokens((current) =>
          (current ?? []).map((candidate) =>
            candidate.id === token.id ? { ...rotated, token: null } : candidate,
          ),
        );
      } else {
        await api(`${TOKENS_URL}/${token.id}`, "DELETE");
        setTokens((current) =>
          (current ?? []).filter((candidate) => candidate.id !== token.id),
        );
      }
    } catch {
      setError(kind);
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!secret || copyInProgress.current) return;
    copyInProgress.current = true;
    setError(null);
    try {
      await navigator.clipboard.writeText(secret);
      setSecret(null);
    } catch {
      setError("copy");
    } finally {
      copyInProgress.current = false;
    }
  }

  return (
    <Section
      title={t("settings.accessTokens.title")}
      description={t("settings.accessTokens.description")}
    >
      <p className="text-xs leading-5 text-text-muted">
        {t("settings.accessTokens.proLicense")}
      </p>

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-sm text-state-danger-text">
            {t(`settings.accessTokens.errors.${error}`)}
          </p>
          {error === "load" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRefreshAttempt((attempt) => attempt + 1)}
            >
              {t("settings.accessTokens.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {secret ? (
        <div className="space-y-3 rounded-xl border border-accent-action/30 bg-accent-action/5 p-4">
          <p className="text-sm font-medium text-text-primary">
            {t("settings.accessTokens.secretShownOnce")}
          </p>
          <code className="block select-all break-all rounded-lg border border-border-quiet bg-surface-canvas px-3 py-2 font-mono text-sm text-text-primary">
            {secret}
          </code>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              onClick={() => void copySecret()}
              className="w-full sm:w-auto"
            >
              {t("settings.accessTokens.copy")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSecret(null)}
              className="w-full sm:w-auto"
            >
              {t("settings.accessTokens.hide")}
            </Button>
          </div>
        </div>
      ) : null}

      {tokens === null && !error ? (
        <p role="status" className="text-sm text-text-muted">
          {t("settings.accessTokens.loading")}
        </p>
      ) : null}

      {tokens !== null && activeTokens.length === 0 ? (
        <p className="text-sm text-text-muted">
          {t("settings.accessTokens.empty")}
        </p>
      ) : null}

      {activeTokens.length > 0 ? (
        <ul className="space-y-3">
          {activeTokens.map((token) => (
            <li
              key={token.id}
              className="rounded-xl border border-border-quiet bg-surface-container p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <h3 className="text-sm font-medium text-text-primary">
                    {token.name}
                  </h3>
                  <p className="font-mono text-xs text-text-muted">
                    {token.token_prefix}
                  </p>
                  <ul className="space-y-0.5 text-xs text-text-muted">
                    {token.scopes.map((scope) => {
                      const labelKey = SCOPE_LABEL_KEYS[scope];
                      return (
                        <li key={scope}>{labelKey ? t(labelKey) : scope}</li>
                      );
                    })}
                  </ul>
                  <p className="flex flex-wrap gap-x-3 text-xs text-text-muted">
                    <span>
                      {t("settings.accessTokens.created", {
                        date: formatDate(token.created_at),
                      })}
                    </span>
                    <span>
                      {token.expires_at
                        ? t("settings.accessTokens.expires", {
                            date: formatDate(token.expires_at),
                          })
                        : t("settings.accessTokens.noExpiry")}
                    </span>
                    <span>
                      {token.last_used_at
                        ? t("settings.accessTokens.lastUsed", {
                            date: formatDate(token.last_used_at),
                          })
                        : t("settings.accessTokens.neverUsed")}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={t("settings.accessTokens.rotateNamed", {
                      name: token.name,
                    })}
                    onClick={() => setPending({ kind: "rotate", token })}
                  >
                    {t("settings.accessTokens.rotate")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    aria-label={t("settings.accessTokens.revokeNamed", {
                      name: token.name,
                    })}
                    onClick={() => setPending({ kind: "revoke", token })}
                  >
                    {t("settings.accessTokens.revoke")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {formOpen ? (
        <div className="space-y-4 rounded-xl border border-border-quiet bg-surface-container p-4">
          <div className="space-y-2">
            <label
              htmlFor={nameId}
              className="text-sm font-medium text-text-primary"
            >
              {t("settings.accessTokens.nameLabel")}
            </label>
            <Input
              id={nameId}
              value={name}
              maxLength={120}
              placeholder={t("settings.accessTokens.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary">
              {t("settings.accessTokens.permissions")}
            </p>
            {SELECTABLE_SCOPE_OPTIONS.map(({ scope, labelKey }) => (
              <ToggleRow
                key={scope}
                label={t(labelKey)}
                checked={scopes.includes(scope)}
                onChange={(enabled) => toggleScope(scope, enabled)}
              />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-text-primary">
              {t("settings.accessTokens.expiryLabel")}
            </p>
            <div className="flex flex-wrap gap-2">
              {EXPIRY_OPTIONS.map((option) => (
                <Button
                  key={option.labelKey}
                  type="button"
                  size="sm"
                  variant={
                    expiresInDays === option.days ? "default" : "outline"
                  }
                  aria-pressed={expiresInDays === option.days}
                  onClick={() => setExpiresInDays(option.days)}
                >
                  {t(option.labelKey)}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              disabled={!canCreate}
              onClick={() => void createToken()}
              className="w-full sm:w-auto"
            >
              {t("settings.accessTokens.create")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={resetForm}
              className="w-full sm:w-auto"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          disabled={busy}
          onClick={() => setFormOpen(true)}
          className="w-full sm:w-auto"
        >
          {t("settings.accessTokens.newToken")}
        </Button>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onConfirm={confirmPending}
        tone={pending?.kind === "revoke" ? "danger" : "default"}
        title={
          pending?.kind === "revoke"
            ? t("settings.accessTokens.revokeConfirmTitle")
            : t("settings.accessTokens.rotateConfirmTitle")
        }
        description={
          pending?.kind === "revoke"
            ? t("settings.accessTokens.revokeConfirmDescription")
            : t("settings.accessTokens.rotateConfirmDescription")
        }
        confirmLabel={
          pending?.kind === "revoke"
            ? t("settings.accessTokens.revokeConfirmAction")
            : t("settings.accessTokens.rotateConfirmAction")
        }
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        ariaLabel={
          pending?.kind === "revoke"
            ? t("settings.accessTokens.revokeConfirmTitle")
            : t("settings.accessTokens.rotateConfirmTitle")
        }
        backdropLabel={t("common.close")}
      />
    </Section>
  );
}
