import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { Button } from "@crate/ui/shadcn/button";

export function RadioHero({
  starting,
  discoveryAvailable,
  onStartDiscovery,
}: {
  starting: boolean;
  discoveryAvailable: boolean;
  onStartDiscovery: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t("radio.title")}
      subtitle={t("radio.intro")}
      actions={
        <Button
          onClick={onStartDiscovery}
          loading={starting}
          disabled={!discoveryAvailable}
        >
          {t("radio.discovery")}
        </Button>
      }
    />
  );
}
