import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Link,
  Loader2,
  LogOut,
  Trash2,
  UserMinus,
  Users,
} from "@crate/ui/icons";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { toast } from "sonner";

import { UserProfileLink } from "@/components/social/UserProfileLink";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { UserProfileAvatar } from "@/pages/UserProfileAvatar";
import type {
  CrateDetail,
  CrateInvite,
  CrateMember,
} from "@/pages/crates-types";

const EXPIRY_OPTIONS = [
  { hours: 24, labelKey: "crate.members.expiry24h" },
  { hours: 168, labelKey: "crate.members.expiry7d" },
  { hours: 720, labelKey: "crate.members.expiry30d" },
  { hours: 0, labelKey: "crate.members.expiryNever" },
] as const;

interface MemberRow {
  userId: number;
  name: string;
  username?: string | null;
  avatar?: string | null;
  role: "owner" | "collaborator";
}

function absoluteInviteUrl(joinUrl: string) {
  return new URL(joinUrl, window.location.origin).toString();
}

async function copyToClipboard(value: string, t: (key: string) => string) {
  if (!navigator.clipboard) {
    toast.error(t("share.toasts.copyFailed"));
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast.success(t("share.toasts.linkCopied"));
  } catch {
    toast.error(t("share.toasts.copyFailed"));
  }
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
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isOwner = crate.access === "owner";
  const isCollaborator = crate.access === "collaborator";
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
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [leaveConfirmation, setLeaveConfirmation] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState("168");
  const [maxUses, setMaxUses] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const crateBase = `/api/crates/${encodeURIComponent(crate.id)}`;
  const members = useApi<CrateMember[]>(
    open && (isOwner || isCollaborator) ? `${crateBase}/members` : null,
  );
  const invites = useApi<CrateInvite[]>(
    open && isOwner && collaborative ? `${crateBase}/invites` : null,
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
      toast.success(t("crate.members.collaborationEnabled"));
      onCrateChange();
    } catch {
      toast.error(t("crate.members.enableFailed"));
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
      toast.error(t("library.crates.memberRemoveFailed"));
    } finally {
      setRemovingUserId(null);
    }
  }

  async function leaveCrate() {
    if (!user) return;
    setLeaving(true);
    try {
      await api(`${crateBase}/members/${user.id}`, "DELETE");
      toast.success(t("crate.members.left", { name: crate.name }));
      onLeft();
    } catch {
      toast.error(t("crate.members.leaveFailed"));
      setLeaving(false);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedMaxUses = Number.parseInt(maxUses, 10);
    setCreatingInvite(true);
    try {
      const invite = await api<CrateInvite>(`${crateBase}/invites`, "POST", {
        expires_in_hours: Number(expiresInHours),
        max_uses: Number.isFinite(parsedMaxUses) ? parsedMaxUses : null,
      });
      setCreatedInviteUrl(absoluteInviteUrl(invite.join_url));
      invites.refetch();
    } catch {
      toast.error(t("library.crates.inviteFailed"));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function revokeInvite(invite: CrateInvite) {
    setRevokingToken(invite.token);
    try {
      await api(
        `${crateBase}/invites/${encodeURIComponent(invite.token)}`,
        "DELETE",
      );
      if (
        createdInviteUrl &&
        createdInviteUrl === absoluteInviteUrl(invite.join_url)
      ) {
        setCreatedInviteUrl(null);
      }
      invites.refetch();
    } catch {
      toast.error(t("crate.members.revokeFailed"));
    } finally {
      setRevokingToken(null);
    }
  }

  return (
    <AppModal
      open={open}
      onClose={onClose}
      maxWidthClassName="sm:max-w-lg"
      panelClassName="listen-glass-panel border-border-quiet"
    >
      <div className="flex max-h-[92vh] flex-col">
        <ModalHeader className="flex items-center justify-between gap-4 bg-transparent px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-primary">
              {t("library.crates.collaborators")}
            </h2>
            <p className="text-xs text-text-muted">
              {isOwner
                ? collaborative
                  ? t("library.crates.inviteDescription")
                  : t("crate.members.collaborationOff")
                : t("crate.members.readOnlySubtitle")}
            </p>
          </div>
          <ModalCloseButton onClick={onClose} />
        </ModalHeader>
        <ModalBody className="space-y-5 p-5">
          {isOwner && !collaborative ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-action/15 bg-accent-action/5 p-4">
              <p className="min-w-0 flex-1 text-sm text-text-primary">
                {t("crate.members.enableHint")}
              </p>
              <Button
                type="button"
                onClick={() => void enableCollaboration()}
                disabled={enabling}
              >
                {enabling ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Users size={15} />
                )}
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
                            className="block truncate text-sm font-medium text-text-primary transition-colors hover:text-accent-action"
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
                      <button
                        type="button"
                        onClick={() => void removeMember(row.userId)}
                        disabled={removingUserId === row.userId}
                        aria-label={t("library.crates.removeMember", {
                          name: row.name,
                        })}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-state-danger/20 px-2.5 py-1 text-xs text-state-danger-text transition-colors hover:bg-state-danger/10 disabled:opacity-60"
                      >
                        {removingUserId === row.userId ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <UserMinus size={12} />
                        )}
                        {t("common.remove")}
                      </button>
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
                  type="button"
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

          {isOwner && collaborative ? (
            <>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">
                  {t("crate.members.activeInvites")}
                </h3>
                {invites.data?.length ? (
                  <ul className="space-y-2">
                    {invites.data.map((invite) => (
                      <InviteRow
                        key={invite.token}
                        invite={invite}
                        locale={i18n.language}
                        revoking={revokingToken === invite.token}
                        onCopy={() =>
                          void copyToClipboard(
                            absoluteInviteUrl(invite.join_url),
                            t,
                          )
                        }
                        onRevoke={() => void revokeInvite(invite)}
                      />
                    ))}
                  </ul>
                ) : invites.loading ? (
                  <div className="flex justify-center py-3">
                    <Loader2
                      size={18}
                      className="animate-spin text-accent-action"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">
                    {invites.error
                      ? t("crate.members.invitesFailed")
                      : t("crate.members.noInvites")}
                  </p>
                )}
              </section>

              <form
                onSubmit={(event) => void createInvite(event)}
                className="space-y-4 rounded-xl border border-accent-action/15 bg-accent-action/5 p-4"
              >
                <h3 className="text-sm font-semibold text-text-primary">
                  {t("crate.members.newInvite")}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs font-medium text-text-muted">
                    {t("crate.members.expiry")}
                    <Select
                      value={expiresInHours}
                      onValueChange={setExpiresInHours}
                    >
                      <SelectTrigger
                        aria-label={t("crate.members.expiry")}
                        className="h-11 w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((option) => (
                          <SelectItem
                            key={option.hours}
                            value={String(option.hours)}
                          >
                            {t(option.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-2 text-xs font-medium text-text-muted">
                    {t("crate.members.maxUses")}
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={500}
                      value={maxUses}
                      onChange={(event) => setMaxUses(event.target.value)}
                      placeholder={t("crate.members.unlimited")}
                      aria-label={t("crate.members.maxUses")}
                      className="h-11"
                    />
                  </label>
                </div>
                <Button type="submit" disabled={creatingInvite}>
                  {creatingInvite ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Link size={15} />
                  )}
                  {t("library.crates.createInvite")}
                </Button>
                {createdInviteUrl ? (
                  <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
                    <div className="flex justify-center">
                      <QrCodeImage
                        value={createdInviteUrl}
                        size={140}
                        darkColor="#000000"
                        lightColor="#ffffff"
                        className="rounded-xl bg-white p-2"
                      />
                    </div>
                    <div className="min-w-0 space-y-3">
                      <input
                        aria-label={t("library.crates.inviteLink")}
                        readOnly
                        value={createdInviteUrl}
                        className="h-10 w-full min-w-0 rounded-lg border border-border-quiet bg-text-primary/[0.04] px-3 text-xs text-text-muted"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          void copyToClipboard(createdInviteUrl, t)
                        }
                      >
                        <Copy size={15} />
                        {t("share.copyLink")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </form>
            </>
          ) : null}

          {isCollaborator ? (
            <section className="border-t border-border-quiet pt-4">
              {leaveConfirmation ? (
                <div className="space-y-3 rounded-xl border border-state-danger/20 bg-state-danger/5 p-4">
                  <p className="text-sm text-text-primary">
                    {t("crate.members.leaveConfirmation", {
                      name: crate.name,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={leaving}
                      onClick={() => void leaveCrate()}
                    >
                      {leaving ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : null}
                      {t("crate.members.confirmLeave")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={leaving}
                      onClick={() => setLeaveConfirmation(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setLeaveConfirmation(true)}
                  className="text-state-danger hover:text-state-danger"
                >
                  <LogOut size={15} />
                  {t("crate.members.leave")}
                </Button>
              )}
            </section>
          ) : null}
        </ModalBody>
      </div>
    </AppModal>
  );
}

function InviteRow({
  invite,
  locale,
  revoking,
  onCopy,
  onRevoke,
}: {
  invite: CrateInvite;
  locale: string;
  revoking: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  const expiry = invite.expires_at
    ? t("crate.members.expires", {
        time: formatRelativeTime(invite.expires_at, locale),
      })
    : t("crate.members.expiryNever");
  const uses =
    invite.max_uses != null
      ? t("crate.members.usesLimited", {
          count: invite.use_count,
          max: invite.max_uses,
        })
      : t("crate.members.usesUnlimited", { count: invite.use_count });

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border-quiet bg-text-primary/[0.03] px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm text-text-primary">{invite.join_url}</p>
        <p className="truncate text-xs text-text-muted">
          {expiry} · {uses}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onCopy}
          aria-label={t("share.copyLink")}
          title={t("share.copyLink")}
          className="flex size-9 items-center justify-center rounded-full text-text-muted hover:bg-text-primary/8 hover:text-text-primary"
        >
          <Copy size={15} />
        </button>
        <button
          type="button"
          onClick={onRevoke}
          disabled={revoking}
          aria-label={t("crate.members.revoke")}
          title={t("crate.members.revoke")}
          className="flex size-9 items-center justify-center rounded-full text-text-muted hover:bg-text-primary/8 hover:text-state-danger disabled:opacity-50"
        >
          {revoking ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Trash2 size={15} />
          )}
        </button>
      </div>
    </li>
  );
}
