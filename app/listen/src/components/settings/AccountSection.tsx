import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Lock, Shield } from "@crate/ui/icons";

import { ConnectDevicesSection } from "@/components/settings/ConnectDevicesSection";
import { Section } from "@/components/settings/SettingsPrimitives";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

interface AuthProviderState {
  enabled: boolean;
  configured: boolean;
  login_url: string | null;
}

interface AuthPublicConfig {
  invite_only?: boolean;
}

export function AccountSection() {
  const { t } = useTranslation();
  const { user, refetch } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [providers, setProviders] = useState<Record<string, AuthProviderState>>(
    {},
  );
  const [authConfig, setAuthConfig] = useState<AuthPublicConfig>({});
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setName(user?.name || "");
    setUsername(user?.username || "");
    setBio(user?.bio || "");
  }, [user?.bio, user?.name, user?.username]);

  useEffect(() => {
    api<Record<string, AuthProviderState>>("/api/auth/providers")
      .then(setProviders)
      .catch(() => {});
    api<AuthPublicConfig>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  async function handleSaveName() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/auth/profile", "PUT", {
        name: name.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
      });
      toast.success(t("settings.account.toasts.profileUpdated"));
      await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Username is already taken")) {
        toast.error(t("settings.account.toasts.usernameTaken"));
      } else {
        toast.error(t("settings.account.toasts.profileUpdateFailed"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword.length < 6) {
      toast.error(t("settings.account.toasts.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.account.toasts.passwordMismatch"));
      return;
    }
    setSaving(true);
    try {
      await api("/api/me/password", "PUT", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success(t("settings.account.toasts.passwordChanged"));
      setShowPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast.error(t("settings.account.toasts.passwordChangeFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkProvider(provider: string) {
    setLinkingProvider(provider);
    try {
      const response = await api<{ login_url: string }>(
        `/api/auth/oauth/${provider}/link`,
        "POST",
        {
          return_to: `${window.location.origin}/settings`,
        },
      );
      window.location.href = response.login_url;
    } catch {
      toast.error(t("settings.account.toasts.linkFailed", { provider }));
      setLinkingProvider(null);
    }
  }

  async function handleUnlinkProvider(provider: string) {
    setUnlinkingProvider(provider);
    try {
      await api(`/api/auth/oauth/${provider}/unlink`, "POST");
      toast.success(t("settings.account.toasts.unlinked", { provider }));
      await refetch();
    } catch {
      toast.error(t("settings.account.toasts.unlinkFailed", { provider }));
    } finally {
      setUnlinkingProvider(null);
    }
  }

  const connectedAccounts = user?.connected_accounts || [];
  const linkedProviders = new Set(
    connectedAccounts
      .filter((item) => item.status !== "unlinked")
      .map((item) => item.provider),
  );
  const socialProviders = Object.entries(providers).filter(
    ([provider, state]) =>
      provider !== "password" && state.configured && state.enabled,
  );

  return (
    <Section
      title={t("settings.account.title")}
      description={t("settings.account.description")}
    >
      <div className="space-y-4">
        <AccountProfileForm
          name={name}
          username={username}
          bio={bio}
          email={user?.email}
          saving={saving}
          profileUnchanged={
            name.trim() === (user?.name || "") &&
            username.trim() === (user?.username || "") &&
            bio.trim() === (user?.bio || "")
          }
          setName={setName}
          setUsername={setUsername}
          setBio={setBio}
          onSave={handleSaveName}
        />
        <ConnectedAccounts
          providers={socialProviders}
          linkedProviders={linkedProviders}
          linkingProvider={linkingProvider}
          unlinkingProvider={unlinkingProvider}
          onLink={handleLinkProvider}
          onUnlink={handleUnlinkProvider}
        />
        <ConnectDevicesSection />
        {authConfig.invite_only ? (
          <div className="flex items-start gap-3 rounded-xl border border-accent-action/20 bg-accent-action/10 px-4 py-3 text-sm text-accent-action">
            <Shield size={16} className="mt-0.5 flex-shrink-0" />
            <div>{t("settings.account.inviteOnlyNotice")}</div>
          </div>
        ) : null}
        <PasswordChangeForm
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          currentPassword={currentPassword}
          newPassword={newPassword}
          confirmPassword={confirmPassword}
          setCurrentPassword={setCurrentPassword}
          setNewPassword={setNewPassword}
          setConfirmPassword={setConfirmPassword}
          saving={saving}
          onChangePassword={handleChangePassword}
        />
      </div>
    </Section>
  );
}

function AccountProfileForm({
  name,
  username,
  bio,
  email,
  saving,
  profileUnchanged,
  setName,
  setUsername,
  setBio,
  onSave,
}: {
  name: string;
  username: string;
  bio: string;
  email?: string | null;
  saving: boolean;
  profileUnchanged: boolean;
  setName: (value: string) => void;
  setUsername: (value: string) => void;
  setBio: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="settings-display-name"
          className="text-xs text-text-muted"
        >
          {t("settings.account.displayName")}
        </label>
        <input
          id="settings-display-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-10 w-full rounded-lg bg-text-primary/5 px-3 text-sm text-text-primary outline-none focus:bg-text-primary/8"
          placeholder={t("auth.register.namePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="settings-username" className="text-xs text-text-muted">
          {t("settings.account.username")}
        </label>
        <input
          id="settings-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/\s+/g, "-"))}
          className="h-10 w-full rounded-lg bg-text-primary/5 px-3 text-sm text-text-primary outline-none focus:bg-text-primary/8"
          placeholder={t("settings.account.usernamePlaceholder")}
        />
        <p className="text-xs text-text-muted">
          {t("settings.account.usernameDescription")}
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="settings-bio" className="text-xs text-text-muted">
          {t("settings.account.bio")}
        </label>
        <textarea
          id="settings-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className="min-h-24 w-full rounded-lg bg-text-primary/5 px-3 py-3 text-sm text-text-primary outline-none focus:bg-text-primary/8"
          placeholder={t("settings.account.bioPlaceholder")}
        />
      </div>
      <div className="flex justify-end">
        <button
          onClick={onSave}
          disabled={saving || profileUnchanged}
          className="h-10 rounded-lg bg-accent-action px-4 text-sm font-medium text-accent-action-foreground transition-opacity disabled:opacity-40"
        >
          {saving ? t("common.saving") : t("settings.account.saveProfile")}
        </button>
      </div>
      <div className="space-y-2">
        <span className="text-xs text-text-muted">{t("common.email")}</span>
        <p className="px-1 text-sm text-text-primary/60">{email || "—"}</p>
      </div>
    </div>
  );
}

function ConnectedAccounts({
  providers,
  linkedProviders,
  linkingProvider,
  unlinkingProvider,
  onLink,
  onUnlink,
}: {
  providers: [string, AuthProviderState][];
  linkedProviders: Set<string>;
  linkingProvider: string | null;
  unlinkingProvider: string | null;
  onLink: (provider: string) => Promise<void>;
  onUnlink: (provider: string) => Promise<void>;
}) {
  const { t } = useTranslation();

  if (providers.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl bg-text-primary/5 p-4">
      <div>
        <div className="text-sm font-medium text-text-primary">
          {t("settings.account.connectedAccounts")}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          {t("settings.account.connectedAccountsDescription")}
        </p>
      </div>
      {providers.map(([provider]) => {
        const linked = linkedProviders.has(provider);
        const busy =
          linkingProvider === provider || unlinkingProvider === provider;
        return (
          <div
            key={provider}
            className="flex items-center justify-between gap-4 rounded-lg border border-border-quiet/10 px-3 py-3"
          >
            <div>
              <div className="text-sm font-medium capitalize text-text-primary">
                {provider}
              </div>
              <div className="text-xs text-text-muted">
                {linked
                  ? t("settings.account.linked")
                  : t("settings.account.notLinked")}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void (linked ? onUnlink(provider) : onLink(provider))
              }
              className="rounded-lg border border-border-quiet/15 bg-text-primary/5 px-3 py-2 text-xs font-medium text-text-primary transition-colors hover:bg-text-primary/10 disabled:opacity-50"
            >
              {busy
                ? t("common.working")
                : linked
                  ? t("settings.account.unlink")
                  : t("settings.account.link")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function PasswordChangeForm({
  showPassword,
  setShowPassword,
  currentPassword,
  newPassword,
  confirmPassword,
  setCurrentPassword,
  setNewPassword,
  setConfirmPassword,
  saving,
  onChangePassword,
}: {
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  setCurrentPassword: (value: string) => void;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  saving: boolean;
  onChangePassword: () => void;
}) {
  const { t } = useTranslation();

  if (!showPassword) {
    return (
      <button
        onClick={() => setShowPassword(true)}
        className="flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <Lock size={14} /> {t("settings.account.changePassword")}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl bg-text-primary/5 p-4">
      <input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder={t("settings.account.currentPassword")}
        className="h-10 w-full rounded-lg bg-text-primary/5 px-3 text-sm text-text-primary outline-none focus:bg-text-primary/8"
        autoComplete="current-password"
      />
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder={t("settings.account.newPassword")}
        className="h-10 w-full rounded-lg bg-text-primary/5 px-3 text-sm text-text-primary outline-none focus:bg-text-primary/8"
        autoComplete="new-password"
      />
      <input
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder={t("settings.account.confirmPassword")}
        className="h-10 w-full rounded-lg bg-text-primary/5 px-3 text-sm text-text-primary outline-none focus:bg-text-primary/8"
        autoComplete="new-password"
      />
      <div className="flex gap-2 pt-1">
        <button
          onClick={onChangePassword}
          disabled={saving}
          className="h-9 rounded-lg bg-accent-action px-4 text-sm font-medium text-accent-action-foreground disabled:opacity-40"
        >
          {t("settings.account.changePasswordAction")}
        </button>
        <button
          onClick={() => {
            setShowPassword(false);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
          }}
          className="h-9 rounded-lg bg-text-primary/5 px-4 text-sm text-text-primary/60"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
