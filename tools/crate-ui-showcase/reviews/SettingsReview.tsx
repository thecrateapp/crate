import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router";
import { useTabParam } from "../../../app/listen/src/hooks/use-tab-param";
import i18next from "i18next";
import ICU from "i18next-icu";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import {
  SETTINGS_TABS,
  SettingsPageView,
  type SettingsTab,
} from "../../../app/listen/src/pages/SettingsPageView";
import {
  SettingsLocationFixture,
  SettingsConnectionsFixture,
  SettingsServersFixture,
} from "./SettingsRemainingFixtures";
import { OfflineSettingsView } from "../../../app/listen/src/components/settings/OfflineSettingsView";
import { SleepTimerView } from "../../../app/listen/src/components/settings/SleepTimerView";
import { InterfacePreferencesControls } from "../../../app/listen/src/components/settings/InterfacePreferencesControls";
import { LanguageSettingsView } from "../../../app/listen/src/components/settings/LanguageSettingsView";
import {
  PlaybackSettingsView,
  type PlaybackSettingsValue,
} from "../../../app/listen/src/components/settings/PlaybackSettingsView";
import {
  AccountProfileForm,
  ConnectedAccounts,
  PasswordChangeForm,
} from "../../../app/listen/src/components/settings/AccountSectionForms";
import { AccountSettingsView } from "../../../app/listen/src/components/settings/AccountSettingsView";
import {
  ConnectDevicesView,
  type ConnectDeviceViewItem,
} from "../../../app/listen/src/components/settings/ConnectDevicesView";
import {
  Section,
  SelectRow,
  ToggleRow,
} from "../../../app/listen/src/components/settings/SettingsPrimitives";
import {
  LISTEN_SUPPORTED_LOCALES,
  type ListenLocale,
} from "../../../app/listen/src/i18n/locales";
import type { UiPreferences } from "@crate/ui/lib/interface-preferences";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
const sampleDevices: ConnectDeviceViewItem[] = [
  {
    id: "current",
    label: "Crate Web",
    meta: "Web app · Browser",
    lastSeen: "Oct 20, 2026, 14:30",
    current: true,
    active: true,
  },
  {
    id: "desktop",
    label: "Living room desktop",
    meta: "Desktop app · Linux",
    lastSeen: "Oct 20, 2026, 14:29",
    current: false,
    active: false,
  },
];
function Scene() {
  const { t } = useTranslation();
  const [tab, setTab] = useTabParam(SETTINGS_TABS, "preferences");
  const [sleep, setSleep] = useState("");
  const [runtime, setRuntime] = useState("desktop"),
    [read, setRead] = useState("ready"),
    [pending, setPending] = useState(false),
    [feature, setFeature] = useState(true),
    [long, setLong] = useState(false);
  const [preferences, setPreferences] = useState<UiPreferences>({
    version: 1,
    motion: "system",
    effects: "subtle",
    density: "comfortable",
  });
  const [language, setLanguage] = useState<"auto" | ListenLocale>("auto");
  const [playback, setPlayback] = useState<PlaybackSettingsValue>({
    crossfadeSeconds: 4,
    smartCrossfadeEnabled: true,
    infinitePlaybackEnabled: true,
    smartPlaylistSuggestionsEnabled: true,
    smartPlaylistSuggestionsCadence: 4,
    playbackDeliveryPolicy: "auto",
    equalizerEnabled: true,
  });
  const [name, setName] = useState("Diego"),
    [username, setUsername] = useState("crate-listener"),
    [bio, setBio] = useState("A record collection that keeps growing."),
    [instagram, setInstagram] = useState("crate-listener"),
    [listed, setListed] = useState(true);
  const [passwordOpen, setPasswordOpen] = useState(false),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const [linked, setLinked] = useState(new Set(["google"])),
    [enabled, setEnabled] = useState(true),
    [devices, setDevices] = useState(sampleDevices),
    [confirm, setConfirm] = useState<string | null>(null),
    [event, setEvent] = useState("No action yet");
  useEffect(() => {
    if (tab !== "connections") setConfirm(null);
  }, [tab]);
  const values = Object.fromEntries(
    [
      "system",
      "reduced",
      "off",
      "subtle",
      "expressive",
      "comfortable",
      "compact",
    ].map((key) => [key, t(`settings.interface.values.${key}`)]),
  );
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-8">
      <MonoLabel
        accent="1BD · Settings"
        meta={["Actual Listen views", "Local fixture actions"]}
      />
      <div className="flex flex-wrap items-end gap-4">
        <SelectRow
          label="Runtime"
          value={runtime}
          onChange={setRuntime}
          options={[
            { value: "desktop", label: "Desktop web" },
            { value: "mobile", label: "Mobile web / iOS" },
            { value: "android", label: "Android native" },
          ]}
        />
        <SelectRow
          label="Device read state"
          value={read}
          onChange={setRead}
          options={["ready", "loading", "empty", "error", "cached error"].map(
            (value) => ({ value, label: value }),
          )}
        />
        <FormField label="Pending account/device action" layout="inline">
          <Checkbox
            checked={pending}
            onCheckedChange={(checked) => setPending(checked === true)}
          />
        </FormField>
        <FormField label="Connect feature" layout="inline">
          <Checkbox
            checked={feature}
            onCheckedChange={(checked) => setFeature(checked === true)}
          />
        </FormField>
        <FormField label="Long values" layout="inline">
          <Checkbox
            checked={long}
            onCheckedChange={(checked) => setLong(checked === true)}
          />
        </FormField>
      </div>
      <SettingsPageView
        value={tab}
        onValueChange={setTab}
        panels={{
          preferences: (
            <>
              <InterfacePreferencesControls
                ruled={false}
                preferences={preferences}
                onChange={(patch) => {
                  setPreferences((current) => ({ ...current, ...patch }));
                  setEvent("Interface preference changed locally");
                }}
                labels={{
                  title: t("settings.interface.title"),
                  description: t("settings.interface.description"),
                  motionLabel: t("settings.interface.motionLabel"),
                  effectsLabel: t("settings.interface.effectsLabel"),
                  densityLabel: t("settings.interface.densityLabel"),
                  values,
                }}
              />
              <LanguageSettingsView
                selection={language}
                activeLanguage={t(
                  `settings.language.options.${language === "auto" ? "en" : language}`,
                )}
                options={LISTEN_SUPPORTED_LOCALES.map((value) => ({
                  value,
                  label: t(`settings.language.options.${value}`),
                }))}
                onChange={(value) => {
                  setLanguage(value);
                  setEvent(`Language choice: ${value}`);
                }}
              />
              <SettingsLocationFixture onEvent={setEvent} />
            </>
          ),
          playback: (
            <>
              <PlaybackSettingsView
                ruled={false}
                value={playback}
                mobilePlaybackRuntime={runtime !== "desktop"}
                androidNativePlayerEnabled={runtime === "android"}
                onChange={(patch) => {
                  setPlayback((current) => ({ ...current, ...patch }));
                  setEvent("Playback preference changed locally");
                }}
              />
              <Section
                title={t("settings.sleep.title")}
                description={t("settings.sleep.subtitle")}
              >
                <SleepTimerView
                  label={t("settings.sleep.title")}
                  value={sleep}
                  options={[
                    { value: "15min", label: t("settings.sleep.modes.15min") },
                    {
                      value: "end_of_track",
                      label: t("settings.sleep.modes.endOfTrack"),
                    },
                  ]}
                  onChange={(value) => {
                    setSleep(value);
                    setEvent("Sleep timer changed locally");
                  }}
                  active={sleep !== ""}
                  cancelLabel={t("common.cancel")}
                  onCancel={() => setSleep("")}
                />
              </Section>
            </>
          ),
          account: (
            <>
              <AccountSettingsView
                ruled={false}
                profile={
                  <AccountProfileForm
                    name={
                      long
                        ? "A very long mixed Case display name for the complete record collection"
                        : name
                    }
                    username={username}
                    bio={bio}
                    instagram={instagram}
                    email="listener@example.test"
                    saving={pending}
                    profileUnchanged={false}
                    setName={setName}
                    setUsername={setUsername}
                    setBio={setBio}
                    setInstagram={setInstagram}
                    onSave={() => setEvent("Profile save requested locally")}
                  />
                }
                listening={
                  <>
                    <ToggleRow
                      label={t("settings.account.pulseListed")}
                      description={t("settings.account.pulseListedDescription")}
                      checked={listed}
                      onChange={setListed}
                    />
                  </>
                }
                providers={
                  <ConnectedAccounts
                    providers={[
                      [
                        "google",
                        { configured: true, enabled: true, login_url: null },
                      ],
                      [
                        "apple",
                        { configured: true, enabled: true, login_url: null },
                      ],
                    ]}
                    linkedProviders={linked}
                    linkingProvider={pending ? "apple" : null}
                    unlinkingProvider={null}
                    onLink={async (provider) => {
                      setLinked((current) => new Set([...current, provider]));
                      setEvent(`Linked locally: ${provider}`);
                    }}
                    onUnlink={async (provider) => {
                      setLinked((current) => {
                        const next = new Set(current);
                        next.delete(provider);
                        return next;
                      });
                      setEvent(`Unlinked locally: ${provider}`);
                    }}
                  />
                }
                security={
                  <PasswordChangeForm
                    showPassword={passwordOpen}
                    setShowPassword={setPasswordOpen}
                    currentPassword={currentPassword}
                    newPassword={newPassword}
                    confirmPassword={confirmPassword}
                    setCurrentPassword={setCurrentPassword}
                    setNewPassword={setNewPassword}
                    setConfirmPassword={setConfirmPassword}
                    saving={pending}
                    onChangePassword={() =>
                      setEvent("Password change requested locally")
                    }
                  />
                }
              />
            </>
          ),
          connections: (
            <>
              {feature ? (
                <ConnectDevicesView
                  ruled={false}
                  devices={
                    ["ready", "cached error"].includes(read)
                      ? devices.map((device) => ({
                          ...device,
                          label: long
                            ? `${device.label} — a long device label that must wrap without moving the actions outside the viewport`
                            : device.label,
                        }))
                      : []
                  }
                  enabled={enabled}
                  updating={pending}
                  forgettingId={pending ? "desktop" : null}
                  loading={read === "loading"}
                  error={["error", "cached error"].includes(read)}
                  onToggle={() => {
                    setEnabled((value) => !value);
                    setEvent("Connect toggled locally");
                  }}
                  onRetry={() => {
                    setRead("ready");
                    setEvent("Device retry requested locally");
                  }}
                  onRevoke={setConfirm}
                />
              ) : (
                <MonoLabel>
                  Feature disabled: Connect section is omitted
                </MonoLabel>
              )}
              <SettingsConnectionsFixture
                ruled={feature}
                busy={pending}
                long={long}
                onEvent={setEvent}
              />
              {runtime === "android" ? (
                <SettingsServersFixture onEvent={setEvent} />
              ) : null}
            </>
          ),
          offline: (
            <OfflineSettingsView
              ruled={false}
              supported
              syncing={false}
              summary={{
                itemCount: 3,
                readyItemCount: 2,
                errorItemCount: 1,
                trackCount: 10,
                readyTrackCount: 8,
                totalBytes: 268435456,
              }}
              storageQuota={1073741824}
              bytesText="256 MB"
              quotaText="1 GB"
              onSync={() => setEvent("Offline sync requested locally")}
              onClear={() => setEvent("Offline clear requested locally")}
            />
          ),
        }}
      />

      <MonoLabel role="status" aria-label="Settings fixture event">
        {event}
      </MonoLabel>
      <ConfirmDialog
        eyebrow={t("actions.confirmation.eyebrow")}
        open={tab === "connections" && confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => {
          setDevices((current) =>
            current.filter((device) => device.id !== confirm),
          );
          setEvent("Device revoked locally");
        }}
        tone="danger"
        title={t("settings.connectDevices.revokeConfirmTitle")}
        description={t("settings.connectDevices.revokeConfirmDescription", {
          name: devices.find((device) => device.id === confirm)?.label ?? "",
        })}
        confirmLabel={t("settings.connectDevices.revoke")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        ariaLabel={t("settings.connectDevices.revokeConfirmTitle")}
        backdropLabel={t("common.close")}
      />
    </main>
  );
}
export function SettingsReview({
  initialTab = "preferences",
}: { initialTab?: SettingsTab } = {}) {
  return (
    <MemoryRouter initialEntries={[`/settings?tab=${initialTab}`]}>
      <I18nextProvider i18n={i18n}>
        <Scene />
      </I18nextProvider>
    </MemoryRouter>
  );
}
