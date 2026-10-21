import { useTranslation } from "react-i18next";
import { SettingsPageView, SETTINGS_TABS } from "./SettingsPageView";
import { CRATE_CONNECT_FEATURE_ENABLED } from "@/lib/crate-connect";
import { useTabParam } from "@/hooks/use-tab-param";
import { ConnectDevicesSection } from "@/components/settings/ConnectDevicesSection";

import { AccessTokensSection } from "@/components/settings/AccessTokensSection";
import { AccountSection } from "@/components/settings/AccountSection";
import { BandcampSection } from "@/components/settings/BandcampSection";
import { LanguageSection } from "@/components/settings/LanguageSection";
import { OpenSubsonicCredentialsSection } from "@/components/settings/OpenSubsonicCredentialsSection";
import { OfflineSection } from "@/components/settings/OfflineSection";
import { PlaybackSection } from "@/components/settings/PlaybackSection";
import { ScrobbleSection } from "@/components/settings/ScrobbleSection";
import { ShowsLocationSection } from "@/components/settings/ShowsLocationSection";
import { SleepTimerSection } from "@/components/settings/SleepTimerSection";
import { ServersSection } from "@/components/settings/ServersSection";
import { InterfacePreferencesSection } from "@/components/settings/InterfacePreferencesSection";

export function Settings() {
  const { i18n } = useTranslation();

  const [tab, setTab] = useTabParam(SETTINGS_TABS, "preferences");

  return (
    <SettingsPageView
      value={tab}
      onValueChange={setTab}
      panels={{
        preferences: (
          <>
            <InterfacePreferencesSection ruled={false} />
            <LanguageSection i18n={i18n} />
            <ShowsLocationSection />
          </>
        ),
        playback: (
          <>
            <PlaybackSection ruled={false} />
            <SleepTimerSection />
          </>
        ),
        account: <AccountSection ruled={false} />,
        connections: (
          <>
            <ConnectDevicesSection ruled={false} />
            <OpenSubsonicCredentialsSection
              ruled={CRATE_CONNECT_FEATURE_ENABLED}
            />
            <AccessTokensSection />
            <ScrobbleSection />
            <BandcampSection />
            <ServersSection />
          </>
        ),
        offline: <OfflineSection ruled={false} />,
      }}
    />
  );
}
