import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api } from "@/lib/api";

import {
  cacheProfileCard,
  fetchProfileCard,
  getCachedProfileCard,
} from "./ProfileHoverCard";
import type { ProfileCardPayload } from "./ProfileHoverCardContent";

interface UseUserFollowInput {
  userId: number;
  username?: string | null;
  displayName: string;
  initialFollowing?: boolean | null;
  enabled?: boolean;
}

export function useUserFollow({
  userId,
  username,
  displayName,
  initialFollowing,
  enabled = true,
}: UseUserFollowInput) {
  const { t } = useTranslation();
  const normalizedUsername = username?.trim().replace(/^@/, "") || "";
  const [following, setFollowing] = useState<boolean | null>(
    () =>
      initialFollowing ??
      (normalizedUsername
        ? getCachedProfileCard(normalizedUsername)?.relationship_state.following
        : undefined) ??
      null,
  );
  const [pending, setPending] = useState(false);

  const ensureLoaded = useCallback(() => {
    if (!enabled || following != null || !normalizedUsername) return;
    fetchProfileCard(normalizedUsername)
      .then((card) => setFollowing(card.relationship_state.following))
      .catch(() => undefined);
  }, [enabled, following, normalizedUsername]);

  const toggleFollow = useCallback(async () => {
    const next = !following;
    setPending(true);
    try {
      const response = await api<{
        relationship_state?: ProfileCardPayload["relationship_state"];
      }>(`/api/users/${userId}/follow`, next ? "POST" : "DELETE");
      setFollowing(next);
      const cached = normalizedUsername
        ? getCachedProfileCard(normalizedUsername)
        : null;
      if (cached) {
        cacheProfileCard(normalizedUsername, {
          ...cached,
          relationship_state: response?.relationship_state ?? {
            ...cached.relationship_state,
            following: next,
            is_friend: next ? cached.relationship_state.is_friend : false,
          },
        });
      }
      toast.success(
        next
          ? t("userProfile.toasts.following", { name: displayName })
          : t("userProfile.toasts.unfollowed", { name: displayName }),
      );
    } catch {
      toast.error(t("actions.user.toasts.followFailed"));
    } finally {
      setPending(false);
    }
  }, [displayName, following, normalizedUsername, t, userId]);

  return { following, pending, ensureLoaded, toggleFollow };
}
