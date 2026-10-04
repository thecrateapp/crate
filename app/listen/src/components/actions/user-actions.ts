import type { TFunction } from "i18next";
import { notify } from "@crate/ui/lib/notify";
import { Share2, UserMinus, UserPlus, UserRound } from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { action } from "@/components/actions/shared";
import { publicShareUrl } from "@/lib/share-url";

export interface UserMenuData {
  id: number;
  username?: string | null;
  name: string;
}

export interface UserActionInput {
  user: UserMenuData;
  following: boolean | null;
  followPending?: boolean;
  isSelf?: boolean;
  onToggleFollow?: () => void | Promise<void>;
  onViewProfile: () => void;
  onShare?: () => void | Promise<void>;
}

export function userProfilePath(username?: string | null): string {
  const normalized = username?.trim().replace(/^@/, "") || "";
  return normalized ? `/users/${encodeURIComponent(normalized)}` : "/people";
}

export async function shareUserProfile(user: UserMenuData, t: TFunction) {
  const url = publicShareUrl(userProfilePath(user.username));
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: user.name, url });
      return;
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
    }
  }
  await navigator.clipboard.writeText(url);
  notify.success(t("share.toasts.linkCopied"));
}

export function buildUserActions(
  input: UserActionInput,
  t: TFunction,
): ItemActionMenuEntry[] {
  const entries: ItemActionMenuEntry[] = [];

  if (!input.isSelf && input.onToggleFollow) {
    entries.push(
      action({
        key: "follow",
        label: input.following ? t("common.unfollow") : t("common.follow"),
        icon: input.following ? UserMinus : UserPlus,
        active: Boolean(input.following),
        disabled: Boolean(input.followPending),
        onSelect: input.onToggleFollow,
      }),
    );
  }

  if (input.user.username) {
    entries.push(
      action({
        key: "profile",
        label: t("people.viewProfile"),
        icon: UserRound,
        onSelect: input.onViewProfile,
      }),
    );
  }

  if (input.user.username && input.onShare) {
    entries.push(
      action({
        key: "share",
        label: t("actions.user.share"),
        icon: Share2,
        onSelect: input.onShare,
      }),
    );
  }

  return entries;
}
