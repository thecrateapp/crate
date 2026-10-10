import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, LogOut, UserMinus, Users } from "@crate/ui/icons";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { Button } from "@crate/ui/shadcn/button";
import { notify } from "@crate/ui/lib/notify";

import { CollaboratorPicker } from "@/components/social/CollaboratorPicker";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { canLeave, canManage } from "@/lib/collaboration-access";
import { UserProfileAvatar } from "@/pages/UserProfileAvatar";
import type { UserSearchResult } from "@/pages/people-types";
import type { CrateDetail, CrateMember } from "@/pages/crates-types";

interface MemberRow {
  userId: number;
  name: string;
  username?: string | null;
  avatar?: string | null;
  role: "owner" | "collaborator";
}

export function CrateMembersModal({
  crate,
  open,
  onClose,
  onCrateChange,
  onLeft,
}: {
  crate: CrateDetail;
  open: boolean;
  onClose: () => void;
  onCrateChange: () => void;
  onLeft: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOwner = canManage(crate);
  const isCollaborator = canLeave(crate);
  const [enabledLocally, setEnabledLocally] = useState(false);
  const [syncedCollaborative, setSyncedCollaborative] = useState(
    crate.is_collaborative,
  );
  if (syncedCollaborative !== crate.is_collaborative) {
    setSyncedCollaborative(crate.is_collaborative);
    setEnabledLocally(false);
  }
  const collaborative = crate.is_collaborative || enabledLocally;
  const [enabling, setEnabling] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);
  const [leaveConfirmation, setLeaveConfirmation] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const crateBase = `/api/crates/${encodeURIComponent(crate.id)}`;
  const members = useApi<CrateMember[]>(
    open && (isOwner || isCollaborator) ? `${crateBase}/members` : null,
  );

  const apiOwner = members.data?.find(
    (member) => member.role === "owner" || member.user_id === crate.owner_id,
  );
  const ownerRow: MemberRow = {
    userId: crate.owner_id,
    name:
      crate.owner_name ||
      apiOwner?.display_name ||
      apiOwner?.name ||
      crate.owner_username ||
      apiOwner?.username ||
      t("people.unknownUser"),
    username: crate.owner_username ?? apiOwner?.username,
    avatar: crate.owner_avatar ?? apiOwner?.avatar,
    role: "owner",
  };
  const collaboratorRows: MemberRow[] = (members.data ?? [])
    .filter(
      (member) => member.role !== "owner" && member.user_id !== crate.owner_id,
    )
    .map((member) => ({
      userId: member.user_id,
      name:
        member.display_name ||
        member.name ||
        member.username ||
        `#${member.user_id}`,
      username: member.username,
      avatar: member.avatar,
      role: "collaborator",
    }));
  const rows = [ownerRow, ...collaboratorRows];

  async function enableCollaboration() {
    setEnabling(true);
    try {
      await api(crateBase, "PUT", { is_collaborative: true });
      setEnabledLocally(true);
      notify.success(t("crate.members.collaborationEnabled"));
      onCrateChange();
    } catch {
      notify.error(t("crate.members.enableFailed"));
    } finally {
      setEnabling(false);
    }
  }

  async function removeMember(userId: number) {
    setRemovingUserId(userId);
    try {
      await api(`${crateBase}/members/${userId}`, "DELETE");
      members.refetch();
    } catch {
      notify.error(t("library.crates.memberRemoveFailed"));
    } finally {
      setRemovingUserId(null);
    }
  }

  async function leaveCrate() {
    if (!user) return;
    setLeaving(true);
    try {
      await api(`${crateBase}/members/${user.id}`, "DELETE");
      notify.success(t("crate.members.left", { name: crate.name }));
      onLeft();
    } catch {
      notify.error(t("crate.members.leaveFailed"));
      setLeaving(false);
    }
  }

  async function addCollaborator(candidate: UserSearchResult) {
    try {
      await api(`${crateBase}/members`, "POST", { user_id: candidate.id });
      notify.success(
        t("collaboration.added", {
          name: candidate.display_name || candidate.username,
        }),
      );
      members.refetch();
      onCrateChange();
    } catch {
      notify.error(t("collaboration.addFailed"));
    }
  }

  return (
    <AppModal
      open={open}
      onClose={onClose}
      size="md"
      title={t("library.crates.collaborators")}
      description={
        isOwner
          ? collaborative
            ? t("collaboration.ownerDescription")
            : t("crate.members.collaborationOff")
          : t("crate.members.readOnlySubtitle")
      }
      closeLabel={t("common.close")}
      closeOnEscape={!leaveConfirmation}
      headerClassName="bg-transparent"
      panelClassName="listen-glass-panel flex flex-col border-border-quiet"
    >
      <div className="flex min-h-0 flex-col">
        <ModalBody className="space-y-5 p-5">
          {isOwner && !collaborative ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-action/15 bg-accent-action/5 p-4">
              <p className="min-w-0 flex-1 text-sm text-text-primary">
                {t("crate.members.enableHint")}
              </p>
              <Button
                onClick={() => void enableCollaboration()}
                loading={enabling}
              >
                {enabling ? null : <Users size={CRATE_ICON_SIZE.sm} />}
                {t("crate.members.enableCollaboration")}
              </Button>
            </div>
          ) : null}

          <section className="space-y-3">
            <ul className="space-y-2">
              {rows.map((row) => {
                const isCurrentUser = user?.id === row.userId;
                return (
                  <li
                    key={`${row.role}-${row.userId}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-quiet bg-text-primary/[0.03] px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <UserProfileAvatar
                        name={row.name}
                        avatar={row.avatar}
                        userId={row.userId}
                        className="size-9 shrink-0 text-sm!"
                      />
                      <div className="min-w-0">
                        {row.username ? (
                          <UserProfileLink
                            username={row.username}
                            hoverClassName="block"
                            className="link-meta block w-fit max-w-full truncate text-sm font-medium text-text-primary"
                          >
                            {row.name}
                          </UserProfileLink>
                        ) : (
                          <div className="truncate text-sm font-medium text-text-primary">
                            {row.name}
                          </div>
                        )}
                        <div className="truncate text-xs text-text-muted">
                          {row.role === "owner"
                            ? t("crate.members.owner")
                            : t("crate.members.collaborator")}
                          {isCurrentUser ? ` · ${t("crate.members.you")}` : ""}
                        </div>
                      </div>
                    </div>
                    {isOwner && row.role !== "owner" ? (
                      <Button
                        variant="danger-soft"
                        size="xs"
                        shape="pill"
                        onClick={() => void removeMember(row.userId)}
                        loading={removingUserId === row.userId}
                        aria-label={t("library.crates.removeMember", {
                          name: row.name,
                        })}
                      >
                        {removingUserId === row.userId ? null : (
                          <UserMinus size={CRATE_ICON_SIZE.micro} />
                        )}
                        {t("common.remove")}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {members.error ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-state-danger/20 bg-state-danger/5 px-3 py-2.5"
              >
                <p className="min-w-0 flex-1 text-sm text-text-primary">
                  {t("crate.members.membersFailed")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => members.refetch()}
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : isOwner &&
              collaborative &&
              !members.loading &&
              collaboratorRows.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t("crate.members.noCollaborators")}
              </p>
            ) : null}
          </section>

          {isOwner ? (
            <CollaboratorPicker
              excludeUserIds={rows.map((row) => row.userId)}
              onAdd={addCollaborator}
            />
          ) : null}

          {isCollaborator ? (
            <section className="border-t border-border-quiet pt-4">
              <Button
                variant="ghost"
                onClick={() => setLeaveConfirmation(true)}
                className="text-state-danger hover:text-state-danger"
              >
                <LogOut size={CRATE_ICON_SIZE.sm} />
                {t("crate.members.leave")}
              </Button>
              <ConfirmDialog
                open={leaveConfirmation}
                tone="danger"
                pending={leaving}
                title={t("crate.members.leave")}
                body={t("crate.members.leaveConfirmation", {
                  name: crate.name,
                })}
                confirmLabel={t("crate.members.confirmLeave")}
                cancelLabel={t("common.cancel")}
                closeLabel={t("common.close")}
                onCancel={() => setLeaveConfirmation(false)}
                onConfirm={() => void leaveCrate()}
              />
            </section>
          ) : null}
        </ModalBody>
      </div>
    </AppModal>
  );
}
