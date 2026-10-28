import { useTranslation } from "react-i18next";
import { Download, ExternalLink } from "@crate/ui/icons";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";

export function BandcampItemActionsView({
  title,
  canImport,
  importing,
  importDisabled,
  hasUrl,
  onImport,
  onOpen,
}: {
  title: string;
  canImport: boolean;
  importing: boolean;
  importDisabled: boolean;
  hasUrl: boolean;
  onImport: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ActionGroup label={title}>
      {canImport ? (
        <ActionButton
          label={`${t("common.import")}: ${title}`}
          tooltip={t("common.import")}
          disabled={importDisabled}
          loading={importing}
          onClick={onImport}
        >
          <Download />
        </ActionButton>
      ) : null}
      {hasUrl ? (
        <ActionButton
          label={`${t("actions.bandcamp.open")}: ${title}`}
          tooltip={t("common.open")}
          onClick={onOpen}
        >
          <ExternalLink />
        </ActionButton>
      ) : null}
    </ActionGroup>
  );
}
