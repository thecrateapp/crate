import { useCallback, useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  Download,
  Heart,
  HeartBold,
  ListPlus,
  Pencil,
  Play,
  Radio,
  Share2,
  Shuffle,
  Users,
} from "@crate/ui/icons";

import type {
  ContextMenuHeader,
  ItemActionMenuEntry,
} from "@crate/ui/domain/actions";
import type { EntityActionMenu } from "@crate/ui/domain/entity";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import { action } from "@/components/actions/shared";
import { isShareableCrate } from "@/components/crates/crate-model";
import type { CrateSummary } from "@/pages/crates-types";

type Handler = () => void | Promise<void>;

export interface CrateActionInput {
  crate: Pick<CrateSummary, "access" | "visibility">;
  onPlay?: Handler;
  onShuffle?: Handler;
  onEdit?: Handler;
  onManageMembers?: Handler;
  onStartRadio?: Handler;
  onMakeAvailableOffline?: Handler;
  onDownload?: Handler;
  onShare?: Handler;
  onToggleFollow?: Handler;
  onCopy?: Handler;
  followed?: boolean;
  followPending?: boolean;
  offlineActionLabel?: string;
  offlineActionDisabled?: boolean;
  offlineActionActive?: boolean;
}

export function buildCrateMenuItems(
  input: CrateActionInput,
  t: TFunction,
): ItemActionMenuEntry[] {
  const canEdit =
    input.crate.access === "owner" || input.crate.access === "collaborator";
  const playback: ItemActionMenuEntry[] = [];
  const more: ItemActionMenuEntry[] = [];

  if (input.onPlay) {
    playback.push(
      action({
        key: "play",
        label: t("actions.crate.play"),
        icon: Play,
        onSelect: input.onPlay,
      }),
    );
  }
  if (input.onShuffle) {
    playback.push(
      action({
        key: "shuffle",
        label: t("actions.crate.shuffle"),
        icon: Shuffle,
        onSelect: input.onShuffle,
      }),
    );
  }
  if (canEdit && input.onEdit) {
    playback.push(
      action({
        key: "edit",
        label: t("actions.crate.edit"),
        icon: Pencil,
        onSelect: input.onEdit,
      }),
    );
  }
  if (input.onManageMembers) {
    playback.push(
      action({
        key: "members",
        label: t("actions.crate.members"),
        icon: Users,
        onSelect: input.onManageMembers,
      }),
    );
  }

  if (input.onToggleFollow) {
    more.push(
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
  if (input.onCopy) {
    more.push(
      action({
        key: "copy",
        label: t("collaboration.addToMyCrates"),
        icon: ListPlus,
        onSelect: input.onCopy,
      }),
    );
  }
  if (input.onStartRadio) {
    more.push(
      action({
        key: "radio",
        label: t("actions.crate.radio"),
        icon: Radio,
        onSelect: input.onStartRadio,
      }),
    );
  }
  if (input.onMakeAvailableOffline) {
    more.push(
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
    more.push(
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
    more.push(
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

  if (!playback.length || !more.length) return [...playback, ...more];
  return [
    ...playback,
    { type: "divider", key: "divider-crate-playback" },
    ...more,
  ];
}

export function useCrateActionMenu(
  input: CrateActionInput,
  header: ContextMenuHeader,
): EntityActionMenu {
  const { t } = useTranslation();
  const latest = useRef({ input, t });
  useEffect(() => {
    latest.current = { input, t };
  });
  const getActions = useCallback(
    () => buildCrateMenuItems(latest.current.input, latest.current.t),
    [],
  );
  return useListenEntityMenu(getActions, header);
}
