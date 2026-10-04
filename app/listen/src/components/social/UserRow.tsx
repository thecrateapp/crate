import { memo, useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { EntityRow, type EntityRowDensity } from "@crate/ui/domain/entity";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import {
  buildUserActions,
  shareUserProfile,
  userProfilePath,
} from "@/components/actions/user-actions";
import { useAuth } from "@/contexts/AuthContext";
import { resolveUserAvatarUrl } from "@/lib/user-avatar";
import { cn } from "@/lib/utils";

import { ProfileHoverCard } from "./ProfileHoverCard";
import { UserAvatar } from "./UserAvatar";
import { useUserFollow } from "./use-user-follow";

export interface UserRowUser {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  bio?: string | null;
}

interface UserRowProps {
  user: UserRowUser;
  following?: boolean | null;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  density?: EntityRowDensity;
  className?: string;
}

export const UserRow = memo(function UserRow({
  user,
  following: initialFollowing,
  subtitle,
  meta,
  trailing,
  density = "default",
  className,
}: UserRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user: viewer } = useAuth();
  const name = user.display_name || user.username || t("people.unknownUser");
  const username = user.username?.trim().replace(/^@/, "") || null;
  const profilePath = userProfilePath(username);
  const isSelf = viewer?.id === user.id;
  const { following, pending, ensureLoaded, toggleFollow } = useUserFollow({
    userId: user.id,
    username,
    displayName: name,
    initialFollowing,
    enabled: !isSelf,
  });

  const getActions = useCallback(
    () =>
      buildUserActions(
        {
          user: { id: user.id, username, name },
          following,
          followPending: pending,
          isSelf,
          onToggleFollow: toggleFollow,
          onViewProfile: () => navigate(profilePath),
          onShare: () => shareUserProfile({ id: user.id, username, name }, t),
        },
        t,
      ),
    [
      following,
      isSelf,
      name,
      navigate,
      pending,
      profilePath,
      t,
      toggleFollow,
      user.id,
      username,
    ],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: name,
      subtitle: username ? `@${username}` : undefined,
      imageUrl: resolveUserAvatarUrl(user.avatar, user.id),
      imageAlt: name,
      imageShape: "circle",
    }),
    [name, user.avatar, user.id, username],
  );
  const baseMenu = useListenEntityMenu(getActions, header);
  const actionMenu = useMemo(
    () =>
      baseMenu
        ? {
            ...baseMenu,
            onOpenChange: (open: boolean) => {
              if (open) ensureLoaded();
            },
          }
        : undefined,
    [baseMenu, ensureLoaded],
  );

  const row = (
    <EntityRow
      title={name}
      subtitle={
        subtitle ?? (username ? `@${username}` : t("people.noUsername"))
      }
      meta={meta ?? (user.bio || undefined)}
      leading={
        <UserAvatar
          name={name}
          avatar={user.avatar}
          userId={user.id}
          alt=""
          className={cn(
            density === "compact" ? "size-10" : "size-11",
            "bg-accent-action/15 text-text-accent",
          )}
        />
      }
      href={profilePath}
      trailing={trailing}
      density={density}
      actionMenu={actionMenu}
      menuLabel={t("actions.menu.more")}
      className={className}
    />
  );

  if (!username) return row;

  return (
    <ProfileHoverCard username={username} className="block">
      {row}
    </ProfileHoverCard>
  );
});
