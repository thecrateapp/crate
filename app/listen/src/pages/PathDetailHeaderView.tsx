import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation";
import { PlayButton } from "@crate/ui/domain/media/PlayButton";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { RefreshCw, Trash2 } from "@crate/ui/icons";
export function PathDetailHeaderView({
  name,
  origin,
  destination,
  count,
  regenerating,
  onPlay,
  onRegenerate,
  onDelete,
}: {
  name: string;
  origin: string;
  destination: string;
  count: number;
  regenerating: boolean;
  onPlay: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={name}
      meta={
        <MonoLabel
          meta={[origin, destination, t("common.trackCountLabel", { count })]}
        />
      }
      actions={
        <>
          <PlayButton
            size="md"
            label={t("player.play")}
            disabled={!count}
            onClick={onPlay}
          />
          <ActionGroup>
            <ActionButton
              label={t("paths.regenerate")}
              loading={regenerating}
              onClick={onRegenerate}
            >
              <RefreshCw aria-hidden="true" />
            </ActionButton>
            <ActionButton label={t("common.delete")} onClick={onDelete}>
              <Trash2 aria-hidden="true" />
            </ActionButton>
          </ActionGroup>
        </>
      }
    />
  );
}
