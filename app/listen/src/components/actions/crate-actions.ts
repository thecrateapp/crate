import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  Download,
  Heart,
  HeartBold,
  Pencil,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { action } from "@/components/actions/shared";
import { isShareableCrate } from "@/components/crates/crate-model";
import type { CrateSummary } from "@/pages/crates-types";

interface CrateActionInput {
  crate: CrateSummary;
  onPlay?: () => void | Promise<void>;
  onShuffle?: () => void | Promise<void>;
  onEdit?: () => void | Promise<void>;
  onStartRadio?: () => void | Promise<void>;
  onMakeAvailableOffline?: () => void | Promise<void>;
  onDownload?: () => void | Promise<void>;
  onShare?: () => void | Promise<void>;
  onToggleFollow?: () => void | Promise<void>;
  followed?: boolean;
  followPending?: boolean;
  offlineActionLabel?: string;
  offlineActionDisabled?: boolean;
  offlineActionActive?: boolean;
}

export function useCrateActionEntries(
  input: CrateActionInput,
): ItemActionMenuEntry[] {
  const { t } = useTranslation();
  const canEdit =
    input.crate.access === "owner" || input.crate.access === "collaborator";

  return useMemo(() => {
    const entries: ItemActionMenuEntry[] = [];

    if (input.onPlay) {
      entries.push(
        action({
          key: "play",
          label: t("actions.crate.play"),
          icon: Play,
          onSelect: input.onPlay,
        }),
      );
    }

    if (input.onShuffle) {
      entries.push(
        action({
          key: "shuffle",
          label: t("actions.crate.shuffle"),
          icon: Shuffle,
          onSelect: input.onShuffle,
        }),
      );
    }

    if (canEdit && input.onEdit) {
      entries.push(
        action({
          key: "edit",
          label: t("actions.crate.edit"),
          icon: Pencil,
          onSelect: input.onEdit,
        }),
      );
    }

    entries.push({ type: "divider", key: "divider-crate-playback" });

    if (input.onToggleFollow) {
      entries.push(
        action({
          key: "follow",
          label: input.followed ? t("common.following") : t("common.follow"),
          icon: input.followed ? HeartBold : Heart,
          active: input.followed,
          disabled: input.followPending,
          onSelect: input.onToggleFollow,
        }),
      );
    }

    if (input.onStartRadio) {
      entries.push(
        action({
          key: "radio",
          label: t("actions.crate.radio"),
          icon: Radio,
          onSelect: input.onStartRadio,
        }),
      );
    }

    if (input.onMakeAvailableOffline) {
      entries.push(
        action({
          key: "offline",
          label: input.offlineActionLabel ?? t("actions.offline.makeAvailable"),
          icon: ArrowDownToLine,
          active: input.offlineActionActive,
          disabled: input.offlineActionDisabled,
          onSelect: input.onMakeAvailableOffline,
        }),
      );
    }

    if (input.onDownload) {
      entries.push(
        action({
          key: "download",
          label: t("actions.crate.downloadZip"),
          icon: Download,
          onSelect: input.onDownload,
        }),
      );
    }

    if (input.onShare) {
      const shareable = isShareableCrate(input.crate);
      entries.push(
        action({
          key: "share",
          label: shareable
            ? t("actions.crate.share")
            : t("actions.crate.sharePrivate"),
          icon: Share2,
          disabled: !shareable,
          onSelect: input.onShare,
        }),
      );
    }

    return entries;
  }, [canEdit, input, t]);
}
