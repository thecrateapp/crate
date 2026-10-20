import { CollectionMemberRow } from "../collections/CollectionMemberRow";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { useState } from "react";
import type { TFunction } from "i18next";
import { CRATE_ICON_SIZE, LogOut, Users, Star } from "@crate/ui/icons";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { CollectionMembersDialog } from "../collections/CollectionMembersDialog";

import { Button } from "@crate/ui/shadcn/button";
import { CollaboratorPicker } from "@/components/social/CollaboratorPicker";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import type { AuthUser } from "@/contexts/auth-context";
import { canLeave, canManage } from "@/lib/collaboration-access";
import type { UserSearchResult } from "@/pages/people-types";
import type { PlaylistData, PlaylistMember } from "@/pages/playlist-types";

export function PlaylistCollaboratorsModal({
  data,
  leaving,
  members,
  onAddMember,
  onClose,
  onLeave,
  onRemoveMember,
  open,
  removingMemberId,
  t,
  user,
}: {
  data: PlaylistData;
  leaving: boolean;
  members: PlaylistMember[];
  onAddMember: (candidate: UserSearchResult) => Promise<void>;
  onClose: () => void;
  onLeave: () => void;
  onRemoveMember: (memberUserId: number) => void;
  open: boolean;
  removingMemberId: number | null;
  t: TFunction;
  user: AuthUser | null;
}) {
  const isOwner = canManage(data);
  const [leaveConfirmation, setLeaveConfirmation] = useState(false);
  const memberIds = [data.user_id, ...members.map((member) => member.user_id)];

  return (
    <CollectionMembersDialog
      open={open}
      onClose={onClose}
      title={t("playlist.collaborators.title")}
      description={
        data.is_collaborative
          ? t("playlist.collaborators.subtitle")
          : t("playlist.collaborators.notCollaborative")
      }
      closeLabel={t("common.close")}
      closeBlocked={leaveConfirmation}
    >
      <div className="space-y-3">
        {members.map((member) => {
          const label =
            member.display_name ||
            member.username ||
            t("playlist.collaborators.userFallback", { id: member.user_id });
          const isCurrentUser = user?.id === member.user_id;
          return (
            <CollectionMemberRow
              key={`${member.playlist_id}-${member.user_id}`}
              name={label}
              nameContent={
                member.username ? (
                  <UserProfileLink
                    username={member.username}
                    hoverClassName="block"
                    className="link-meta block w-fit max-w-full truncate"
                  >
                    {label}
                  </UserProfileLink>
                ) : (
                  label
                )
              }
              handle={
                member.username
                  ? `@${member.username}`
                  : t("playlist.collaborators.profile")
              }
              badge={
                <InfoBadge
                  icon={member.role === "owner" ? Star : Users}
                  tone={member.role === "owner" ? "accent" : "neutral"}
                >
                  {t(
                    member.role === "owner"
                      ? "playlist.collaborators.owner"
                      : "playlist.collaborators.collab",
                  )}
                </InfoBadge>
              }
              removeLabel={t("library.crates.removeMember", { name: label })}
              pending={removingMemberId === member.user_id}
              onRemove={
                isOwner && member.role !== "owner" && !isCurrentUser
                  ? () => onRemoveMember(member.user_id)
                  : undefined
              }
            />
          );
        })}
      </div>

      {isOwner ? (
        <CollaboratorPicker excludeUserIds={memberIds} onAdd={onAddMember} />
      ) : null}

      {canLeave(data) ? (
        <section className="border-t border-border-quiet pt-4">
          <Button
            variant="ghost"
            onClick={() => setLeaveConfirmation(true)}
            className="text-state-danger hover:text-state-danger"
          >
            <LogOut size={CRATE_ICON_SIZE.sm} />
            {t("collaboration.leavePlaylist")}
          </Button>
          <ConfirmDialog
            eyebrow={t("actions.confirmation.eyebrow")}
            open={leaveConfirmation}
            tone="danger"
            pending={leaving}
            title={t("collaboration.leavePlaylist")}
            body={t("collaboration.leavePlaylistConfirmation", {
              name: data.name,
            })}
            confirmLabel={t("collaboration.leave")}
            cancelLabel={t("common.cancel")}
            closeLabel={t("common.close")}
            onCancel={() => setLeaveConfirmation(false)}
            onConfirm={onLeave}
          />
        </section>
      ) : null}
    </CollectionMembersDialog>
  );
}
