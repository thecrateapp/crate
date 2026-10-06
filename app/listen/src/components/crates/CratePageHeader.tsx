import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { TFunction } from "i18next";
import { CRATE_ICON_SIZE, Share2 } from "@crate/ui/icons";
import { GenrePillRow } from "@crate/ui/domain/genres/GenrePill";
import { PageHero, type HeroSecondaryAction } from "@crate/ui/domain/hero";

import { CrateImage } from "@/components/artwork/CrateImage";
import {
  CrateCoverFlow,
  type CrateCoverUrl,
} from "@/components/crates/CrateCoverFlow";
import {
  crateOwnerName,
  isShareableCrate,
  type NumberedCrateAlbum,
} from "@/components/crates/crate-model";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { UserProfileAvatar } from "@/pages/UserProfileAvatar";
import { genreSlug } from "@/lib/utils";
import type { CrateDetail } from "@/pages/crates-types";

export const CRATE_SECONDARY_ACTION_CLASS =
  "min-w-0 px-0 text-2xs md:px-1.5 md:text-xs";

export function CrateHero({
  crate,
  albums,
  coverUrl,
  followerCount,
  actions,
  contentClassName,
}: {
  crate: CrateDetail;
  albums: NumberedCrateAlbum[];
  coverUrl: CrateCoverUrl;
  followerCount: number;
  actions: ReactNode;
  contentClassName?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ownerName = crateOwnerName(crate) ?? t("people.unknownUser");
  const backgroundAlbum = albums.find((album) => album.has_cover);
  const backgroundUrl = backgroundAlbum ? coverUrl(backgroundAlbum, 512) : null;
  const ownerLine = (
    <>
      <UserProfileAvatar
        name={ownerName}
        avatar={crate.owner_avatar}
        userId={crate.owner_id}
        className="size-6 shrink-0 text-xs!"
      />
      {t("crate.page.kicker", { name: ownerName })}
    </>
  );

  return (
    <div data-testid="crate-hero">
      <PageHero
        variant="media"
        className="h-auto lg:h-auto"
        contentClassName={contentClassName}
        artworkClassName="block aspect-auto w-full overflow-visible rounded-none bg-transparent shadow-none ring-0 sm:w-1/2 lg:w-[58%] lg:max-w-[720px]"
        titleClassName="max-w-4xl text-2xl"
        actionsClassName="pt-0"
        background={{
          treatment: "blur",
          render: (className) =>
            backgroundUrl ? (
              <CrateImage
                data-testid="crate-hero-background"
                src={backgroundUrl}
                alt=""
                className={className}
              />
            ) : null,
        }}
        artwork={
          <CrateCoverFlow
            albums={albums}
            isOrdered={crate.is_ordered}
            crateName={crate.name}
            loopEnabled={crate.loop_enabled}
            coverUrl={coverUrl}
          />
        }
        title={crate.name}
        subtitle={
          crate.owner_username ? (
            <UserProfileLink
              username={crate.owner_username}
              className="link-meta inline-flex items-center gap-2 self-start text-sm"
            >
              {ownerLine}
            </UserProfileLink>
          ) : (
            <span className="inline-flex items-center gap-2 self-start text-sm text-text-muted">
              {ownerLine}
            </span>
          )
        }
        meta={[
          t("common.albumCountLabel", { count: albums.length }),
          crate.track_count > 0
            ? t("common.trackCountLabel", { count: crate.track_count })
            : null,
          followerCount > 0
            ? t("common.followerCountLabel", { count: followerCount })
            : null,
        ]}
        metaSeparator="dot"
        description={crate.description || undefined}
        actions={actions}
      >
        {crate.genre_profile?.length ? (
          <GenrePillRow
            items={crate.genre_profile}
            max={6}
            className="mt-3 hidden sm:flex"
            onSelect={(item) =>
              navigate(
                `/explore?genre=${encodeURIComponent(
                  item.slug || genreSlug(item.name),
                )}`,
              )
            }
          />
        ) : null}
        <div aria-hidden="true" className="hidden lg:block lg:h-14" />
      </PageHero>
    </div>
  );
}

export function crateShareAction(
  crate: CrateDetail,
  onShare: () => void,
  t: TFunction,
): HeroSecondaryAction {
  const shareable = isShareableCrate(crate);
  const label = shareable
    ? t("crate.page.share")
    : t("crate.page.sharePrivateHint");
  return {
    key: "share",
    label: t("common.share"),
    icon: <Share2 size={CRATE_ICON_SIZE.lg} />,
    ariaLabel: label,
    title: label,
    disabled: !shareable,
    onClick: onShare,
    className: CRATE_SECONDARY_ACTION_CLASS,
  };
}
