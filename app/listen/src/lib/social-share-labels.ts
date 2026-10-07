import type { TFunction } from "i18next";

import {
  buildShareText,
  type ShareCardLabels,
  type SharePayload,
} from "@/lib/social-share";

function shareOwnerName(payload: SharePayload): string | null {
  return payload.crateOwnerName?.trim() || payload.subtitle?.trim() || null;
}

function shareAlbumCount(payload: SharePayload): number {
  return payload.crateAlbumCount ?? payload.crateAlbums?.length ?? 0;
}

export function buildLocalizedShareText(
  t: TFunction,
  payload: SharePayload,
): string {
  if (payload.kind !== "crate") return buildShareText(payload);
  const owner = shareOwnerName(payload);
  const albums = t("common.albumCountLabel", {
    count: shareAlbumCount(payload),
  });
  const name = payload.title.trim();
  return owner
    ? t("share.text.crate", { name, owner, albums })
    : t("share.text.crateNoOwner", { name, albums });
}

export function buildShareCardLabels(
  t: TFunction,
  payload: SharePayload,
): ShareCardLabels {
  const cta = t("share.card.cta");
  if (payload.kind === "crate") {
    const cardOwner =
      payload.crateOwnerInstagram?.trim() || shareOwnerName(payload);
    const albumLabel = t("common.albumCountLabel", {
      count: shareAlbumCount(payload),
    });
    const trackLabel =
      payload.crateTrackCount && payload.crateTrackCount > 0
        ? t("common.trackCountLabel", { count: payload.crateTrackCount })
        : null;
    return {
      subtitle: cardOwner
        ? t("share.card.crateBy", { owner: cardOwner })
        : "Crate",
      metadata: trackLabel ? `${albumLabel} · ${trackLabel}` : albumLabel,
      kicker: payload.crateIsOrdered
        ? t("share.card.ranked")
        : t("share.card.selection"),
      cta,
    };
  }

  const name = payload.subtitle?.trim();
  let subtitle: string;
  if (!name) {
    subtitle = payload.kind === "artist" ? t("share.card.artist") : "Crate";
  } else if (payload.kind === "track") {
    subtitle = t("share.card.trackBy", { name });
  } else if (payload.kind === "album") {
    subtitle = t("share.card.albumBy", { name });
  } else if (payload.kind === "playlist") {
    subtitle = t("share.card.playlistBy", { name });
  } else {
    subtitle = name;
  }
  return { subtitle, cta };
}
