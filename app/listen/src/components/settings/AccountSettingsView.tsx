import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "./SettingsPrimitives";

/** Account regions shared by the production controller and isolated review. */
export function AccountSettingsView({
  profile,
  listening,
  providers,
  security,
}: {
  profile: ReactNode;
  listening: ReactNode;
  providers: ReactNode;
  security: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Section title={t("settings.account.profileTitle")}>{profile}</Section>
      <Section title={t("settings.account.listeningTitle")}>
        {listening}
      </Section>
      {providers}
      <Section title={t("settings.account.securityTitle")}>{security}</Section>
    </>
  );
}
