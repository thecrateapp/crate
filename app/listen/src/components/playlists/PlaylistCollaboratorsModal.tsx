import { useState } from "react";
import type { TFunction } from "i18next";
import {
  CRATE_ICON_SIZE,
  LogOut,
  UserMinus,
  Users,
  Star,
} from "@crate/ui/icons";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";
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
    <AppModal
      open={open}
      onClose={onClose}
      size="md"
      title={t("playlist.collaborators.title")}
      description={
        data.is_collaborative
          ? t("playlist.collaborators.subtitle")
          : t("playlist.collaborators.notCollaborative")
      }
      closeLabel={t("common.close")}
      closeOnEscape={!leaveConfirmation}
    >
      <ModalBody className="space-y-5 p-5 ">
        <div className="space-y-3">
          {members.map((member) => {
            const label =
              member.display_name ||
              member.username ||
              t("playlist.collaborators.userFallback", { id: member.user_id });
            const isCurrentUser = user?.id === member.user_id;
            return (
              <div
                key={`${member.playlist_id}-${member.user_id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-quiet bg-text-primary/[0.03] px-4 py-3"
              >
                <div className="min-w-0">
                  {member.username ? (
                    <UserProfileLink
                      username={member.username}
                      hoverClassName="block"
                      className="link-meta block w-fit max-w-full truncate text-sm font-medium text-text-primary"
                    >
                      {label}
                    </UserProfileLink>
                  ) : (
                    <div className="truncate text-sm font-medium text-text-primary">
                      {label}
                    </div>
                  )}
                  <div className="truncate text-xs text-text-muted">
                    {member.username
                      ? `@${member.username}`
                      : t("playlist.collaborators.profile")}{" "}
                    · {member.role}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CrateBadge
                    icon={member.role === "owner" ? Star : Users}
                    tone={member.role === "owner" ? "accent" : "neutral"}
                  >
                    {member.role === "owner"
                      ? t("playlist.collaborators.owner")
                      : t("playlist.collaborators.collab")}
                  </CrateBadge>
                  {isOwner && member.role !== "owner" && !isCurrentUser ? (
                    <Button
                      variant="danger-soft"
                      size="xs"
                      shape="pill"
                      onClick={() => onRemoveMember(member.user_id)}
                      loading={removingMemberId === member.user_id}
                    >
                      {removingMemberId === member.user_id ? null : (
                        <UserMinus size={CRATE_ICON_SIZE.micro} />
                      )}
                      {t("common.remove")}
                    </Button>
                  ) : null}
                </div>
              </div>
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
      </ModalBody>
    </AppModal>
  );
}
