import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation";

import { AccountSection } from "@/components/settings/AccountSection";
import { BandcampSection } from "@/components/settings/BandcampSection";
import { LanguageSection } from "@/components/settings/LanguageSection";
import { LinksSection } from "@/components/settings/LinksSection";
import { OpenSubsonicCredentialsSection } from "@/components/settings/OpenSubsonicCredentialsSection";
import { OfflineSection } from "@/components/settings/OfflineSection";
import { PlaybackSection } from "@/components/settings/PlaybackSection";
import { ScrobbleSection } from "@/components/settings/ScrobbleSection";
import { ShowsLocationSection } from "@/components/settings/ShowsLocationSection";
import { SleepTimerSection } from "@/components/settings/SleepTimerSection";
import { ServersSection } from "@/components/settings/ServersSection";
import { InterfacePreferencesSection } from "@/components/settings/InterfacePreferencesSection";

export function Settings() {
  const { t, i18n } = useTranslation();

  return (
    <div className="space-y-8">
      <PageHeader
        className="settings-header"
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
      />

      <InterfacePreferencesSection />
      <LanguageSection i18n={i18n} />
      <PlaybackSection />
      <OfflineSection />
      <ServersSection />
      <ShowsLocationSection />
      <SleepTimerSection />
      <AccountSection />
      <OpenSubsonicCredentialsSection />
      <ScrobbleSection />
      <BandcampSection />
      <LinksSection />
    </div>
  );
}
