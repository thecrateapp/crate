import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api } from "@/lib/api";

interface UseCrateFollowOptions {
  crateId: string | null;
  initialFollowed: boolean;
  initialFollowerCount?: number;
  enabled: boolean;
}

interface FollowOverride {
  sourceKey: string;
  followed: boolean;
}

export function useCrateFollow({
  crateId,
  initialFollowed,
  initialFollowerCount = 0,
  enabled,
}: UseCrateFollowOptions) {
  const { t } = useTranslation();
  const sourceKey = `${crateId ?? ""}:${initialFollowed}`;
  const [override, setOverride] = useState<FollowOverride | null>(null);
  const [pending, setPending] = useState(false);
  const followed =
    override?.sourceKey === sourceKey ? override.followed : initialFollowed;
  const followerDelta = followed === initialFollowed ? 0 : followed ? 1 : -1;
  const followerCount = Math.max(0, initialFollowerCount + followerDelta);

  const toggle = useCallback(async () => {
    if (!enabled || !crateId || pending) return;

    const nextFollowed = !followed;
    setOverride({ sourceKey, followed: nextFollowed });
    setPending(true);
    try {
      await api(
        `/api/crates/${encodeURIComponent(crateId)}/follow`,
        nextFollowed ? "POST" : "DELETE",
      );
    } catch {
      setOverride({ sourceKey, followed: !nextFollowed });
      toast.error(t("actions.crate.toasts.followFailed"));
    } finally {
      setPending(false);
    }
  }, [crateId, enabled, followed, pending, sourceKey, t]);

  return { followed, followerCount, pending, toggle };
}
