import { CollectionMemberRow } from "../collections/CollectionMemberRow";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, LogOut, Users } from "@crate/ui/icons";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { CollectionMembersDialog } from "../collections/CollectionMembersDialog";
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
    <CollectionMembersDialog
      open={open}
      onClose={onClose}
      title={t("library.crates.collaborators")}
      description={
        isOwner
          ? collaborative
            ? t("collaboration.ownerDescription")
            : t("crate.members.collaborationOff")
          : t("crate.members.readOnlySubtitle")
      }
      closeLabel={t("common.close")}
      closeBlocked={leaveConfirmation}
    >
      <div className="flex min-h-0 flex-col">
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
                <li key={`${row.role}-${row.userId}`}>
                  <CollectionMemberRow
                    name={row.name}
                    nameContent={
                      row.username ? (
                        <UserProfileLink
                          username={row.username}
                          hoverClassName="block"
                          className="link-meta block w-fit max-w-full truncate"
                        >
                          {row.name}
                        </UserProfileLink>
                      ) : (
                        row.name
                      )
                    }
                    avatar={
                      <UserProfileAvatar
                        name={row.name}
                        avatar={row.avatar}
                        userId={row.userId}
                        className="size-9 shrink-0 text-sm!"
                      />
                    }
                    roleLabel={`${t(row.role === "owner" ? "crate.members.owner" : "crate.members.collaborator")}${isCurrentUser ? ` · ${t("crate.members.you")}` : ""}`}
                    removeLabel={t("library.crates.removeMember", {
                      name: row.name,
                    })}
                    pending={removingUserId === row.userId}
                    onRemove={
                      isOwner && row.role !== "owner"
                        ? () => void removeMember(row.userId)
                        : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
          {members.error ? (
            <ErrorState
              message={t("crate.members.membersFailed")}
              retryLabel={t("common.retry")}
              onRetry={() => members.refetch()}
            />
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
              eyebrow={t("actions.confirmation.eyebrow")}
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
      </div>
    </CollectionMembersDialog>
  );
}
