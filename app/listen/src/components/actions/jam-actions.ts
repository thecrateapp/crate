import type { TFunction } from "i18next";
import { ArrowRight, Trash2, Users } from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { action } from "@/components/actions/shared";

export interface JamRoomActionInput {
  isMember: boolean;
  isHost: boolean;
  joining?: boolean;
  deleting?: boolean;
  onJoin: () => void;
  onDelete?: () => void;
}

export function buildJamRoomActions(
  input: JamRoomActionInput,
  t: TFunction,
): ItemActionMenuEntry[] {
  const entries: ItemActionMenuEntry[] = [
    action({
      key: "open",
      label: input.isMember ? t("actions.jam.open") : t("jam.lobby.joinRoom"),
      icon: input.isMember ? ArrowRight : Users,
      disabled: input.joining,
      onSelect: input.onJoin,
    }),
  ];

  if (input.isHost && input.onDelete) {
    entries.push(
      action({
        key: "delete",
        label: t("jam.delete.title"),
        icon: Trash2,
        danger: true,
        disabled: input.deleting,
        onSelect: input.onDelete,
      }),
    );
  }

  return entries;
}
