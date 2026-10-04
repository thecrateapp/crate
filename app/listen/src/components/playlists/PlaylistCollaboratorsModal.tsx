import type { TFunction } from "i18next";
import { CRATE_ICON_SIZE, Copy, UserMinus, Users } from "@crate/ui/icons";

import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { CratePill } from "@crate/ui/primitives/CrateBadge";
import { Button } from "@crate/ui/shadcn/button";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import type { AuthUser } from "@/contexts/auth-context";
import type { PlaylistData, PlaylistMember } from "@/pages/playlist-types";

export function PlaylistCollaboratorsModal({
  creatingInvite,
  data,
  inviteLink,
  isOwner,
  members,
  onClose,
  onCopyInviteLink,
  onCreateInvite,
  onRemoveMember,
  open,
  removingMemberId,
  t,
  user,
}: {
  creatingInvite: boolean;
  data: PlaylistData;
  inviteLink: string | null;
  isOwner: boolean;
  members: PlaylistMember[];
  onClose: () => void;
  onCopyInviteLink: () => void;
  onCreateInvite: () => void;
  onRemoveMember: (memberUserId: number) => void;
  open: boolean;
  removingMemberId: number | null;
  t: TFunction;
  user: AuthUser | null;
}) {
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
    >
      <ModalBody className="space-y-5 p-5 ">
        {data.is_collaborative && isOwner ? (
          <div className="rounded-xl border border-accent-action/15 bg-accent-action/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {t("playlist.collaborators.inviteTitle")}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {t("playlist.collaborators.inviteSubtitle")}
                </div>
              </div>
              <Button
                onClick={onCreateInvite}
                loading={creatingInvite}
                className="rounded-lg"
              >
                {creatingInvite ? null : <Users size={CRATE_ICON_SIZE.sm} />}
                {t("playlist.collaborators.createInvite")}
              </Button>
            </div>
            {inviteLink ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-[0.9fr_1.1fr]">
                <div className="flex justify-center">
                  <QrCodeImage
                    value={inviteLink}
                    size={160}
                    className="rounded-xl border border-border-quiet bg-surface-canvas p-3"
                  />
                </div>
                <div className="space-y-3">
                  <div className="break-all border-l-2 border-border-quiet px-4 py-3 text-xs text-text-muted">
                    {inviteLink}
                  </div>
                  <Button
                    variant="outline"
                    onClick={onCopyInviteLink}
                    className="rounded-lg"
                  >
                    <Copy size={CRATE_ICON_SIZE.sm} />
                    {t("playlist.collaborators.copyInvite")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

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
                  <CratePill tone="neutral">
                    {member.role === "owner"
                      ? t("playlist.collaborators.owner")
                      : t("playlist.collaborators.collab")}
                  </CratePill>
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
      </ModalBody>
    </AppModal>
  );
}
