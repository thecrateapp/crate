import { useTranslation } from "react-i18next";
import { SettingsPageView, SETTINGS_TABS } from "./SettingsPageView";
import { useTabParam } from "@/hooks/use-tab-param";
import { ConnectDevicesSection } from "@/components/settings/ConnectDevicesSection";

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
            <InterfacePreferencesSection />
            <LanguageSection i18n={i18n} />
            <ShowsLocationSection />
          </>
        ),
        playback: (
          <>
            <PlaybackSection />
            <SleepTimerSection />
          </>
        ),
        account: <AccountSection />,
        connections: (
          <>
            <ConnectDevicesSection />
            <OpenSubsonicCredentialsSection />
            <ScrobbleSection />
            <BandcampSection />
            <ServersSection />
          </>
        ),
        offline: <OfflineSection />,
      }}
    />
  );
}
