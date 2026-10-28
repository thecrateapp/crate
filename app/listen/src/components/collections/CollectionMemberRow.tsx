import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { CRATE_ICON_SIZE, UserMinus } from "@crate/ui/icons";

export function CollectionMemberRow({
  name,
  nameContent,
  handle,
  roleLabel,
  avatar,
  badge,
  action,
  removeLabel,
  pending = false,
  onRemove,
}: {
  name: string;
  nameContent?: ReactNode;
  handle?: ReactNode;
  roleLabel?: string;
  avatar?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  removeLabel?: string;
  pending?: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <EntityRow
      title={name}
      titleContent={nameContent}
      subtitle={handle}
      leading={avatar}
      meta={
        roleLabel ? <MonoLabel as="span">{roleLabel}</MonoLabel> : undefined
      }
      trailing={
        <ActionGroup label={t("playlist.collaborators.title")}>
          {badge}
          {action}
          {onRemove ? (
            <ActionButton
              label={removeLabel || t("common.remove")}
              tooltip={t("common.remove")}
              loading={pending}
              onClick={onRemove}
            >
              <UserMinus size={CRATE_ICON_SIZE.md} />
            </ActionButton>
          ) : null}
        </ActionGroup>
      }
    />
  );
}
