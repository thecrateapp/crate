import { useTranslation } from "react-i18next";

import { CRATE_ICON_SIZE, Lock } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { GoogleIcon, AppleIcon } from "@crate/ui/domain/auth/OAuthButtons";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { Section } from "./SettingsPrimitives";

export function AccountProfileForm({
  name,
  username,
  bio,
  instagram,
  email,
  saving,
  profileUnchanged,
  setName,
  setUsername,
  setBio,
  setInstagram,
  onSave,
}: {
  name: string;
  username: string;
  bio: string;
  instagram: string;
  email?: string | null;
  saving: boolean;
  profileUnchanged: boolean;
  setName: (value: string) => void;
  setUsername: (value: string) => void;
  setBio: (value: string) => void;
  setInstagram: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4 @md:grid-cols-2">
      <FormField label={t("common.email")}>
        <Input
          id="settings-email"
          type="email"
          value={email || ""}
          placeholder="—"
          readOnly
          autoComplete="email"
        />
      </FormField>
      <FormField label={t("settings.account.displayName")}>
        <Input
          id="settings-display-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("auth.register.namePlaceholder")}
        />
      </FormField>
      <FormField
        label={t("settings.account.username")}
        hint={t("settings.account.usernameDescription")}
      >
        <Input
          id="settings-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/\s+/g, "-"))}
          placeholder={t("settings.account.usernamePlaceholder")}
        />
      </FormField>
      <FormField
        label={t("settings.account.instagram")}
        hint={t("settings.account.instagramDescription")}
      >
        <Input
          id="settings-instagram"
          type="text"
          value={instagram}
          onChange={(e) => setInstagram(e.target.value.replace(/\s+/g, ""))}
          placeholder={t("settings.account.instagramPlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </FormField>
      <FormField label={t("settings.account.bio")} className="@md:col-span-2">
        <Textarea
          id="settings-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder={t("settings.account.bioPlaceholder")}
        />
      </FormField>
      <div className="flex justify-end @md:col-span-2">
        <Button onClick={onSave} disabled={saving || profileUnchanged}>
          {saving ? t("common.saving") : t("settings.account.saveProfile")}
        </Button>
      </div>
    </div>
  );
}

interface AuthProviderState {
  enabled: boolean;
  configured: boolean;
  login_url: string | null;
}

export function ConnectedAccounts({
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
    <Section
      title={t("settings.account.connectedAccounts")}
      description={t("settings.account.connectedAccountsDescription")}
    >
      <div className="grid max-w-xl divide-y divide-border-quiet">
        {providers.map(([provider]) => {
          const linked = linkedProviders.has(provider);
          const busy =
            linkingProvider === provider || unlinkingProvider === provider;
          return (
            <EntityRow
              key={provider}
              title={
                provider === "google"
                  ? "Google"
                  : provider === "apple"
                    ? "Apple"
                    : provider
              }
              density="compact"
              menuButton="none"
              truncate={false}
              leading={
                provider === "google" || provider === "apple" ? (
                  <span
                    aria-hidden="true"
                    className="flex shrink-0 items-center"
                  >
                    {provider === "google" ? (
                      <GoogleIcon className="size-6" />
                    ) : (
                      <AppleIcon className="size-6" />
                    )}
                  </span>
                ) : undefined
              }
              subtitle={
                <StatusDot
                  tone={linked ? "on" : "off"}
                  label={
                    linked
                      ? t("settings.account.linked")
                      : t("settings.account.notLinked")
                  }
                />
              }
              trailing={
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void (linked ? onUnlink(provider) : onLink(provider))
                  }
                >
                  {busy
                    ? t("common.working")
                    : linked
                      ? t("settings.account.unlink")
                      : t("settings.account.link")}
                </Button>
              }
            />
          );
        })}
      </div>
    </Section>
  );
}

export function PasswordChangeForm({
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
      <Button variant="ghost" onClick={() => setShowPassword(true)}>
        <Lock size={CRATE_ICON_SIZE.xs} />{" "}
        {t("settings.account.changePassword")}
      </Button>
    );
  }

  return (
    <div className="grid gap-4 @md:grid-cols-2">
      <FormField
        label={t("settings.account.currentPassword")}
        className="@md:col-span-2"
      >
        <Input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder={t("settings.account.currentPassword")}
          aria-label={t("settings.account.currentPassword")}
          autoComplete="current-password"
        />
      </FormField>
      <FormField label={t("settings.account.newPassword")}>
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t("settings.account.newPassword")}
          aria-label={t("settings.account.newPassword")}
          autoComplete="new-password"
        />
      </FormField>
      <FormField label={t("settings.account.confirmPassword")}>
        <Input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t("settings.account.confirmPassword")}
          aria-label={t("settings.account.confirmPassword")}
          autoComplete="new-password"
        />
      </FormField>
      <div className="flex gap-2 pt-1 @md:col-span-2">
        <Button onClick={onChangePassword} disabled={saving}>
          {t("settings.account.changePasswordAction")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setShowPassword(false);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
