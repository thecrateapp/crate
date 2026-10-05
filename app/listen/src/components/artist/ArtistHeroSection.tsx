import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  ChevronDown,
  CRATE_ICON_SIZE,
  ListMusic,
  Play,
  Radio,
  Share2,
  Shuffle,
  Users,
} from "@crate/ui/icons";
import {
  ArtistHeroFrame,
  artistHeroArtworkFitClassName,
} from "@crate/ui/domain/ArtistHeroFrame";
import { ArtistBioText } from "@crate/ui/domain/ArtistBioText";
import {
  HERO_SECONDARY_ACTION_ACTIVE_CLASS,
  HERO_SECONDARY_ACTION_CLASS,
  PageHero,
} from "@crate/ui/domain/hero";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

import { buildArtistMenuItems } from "@/components/actions/artist-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  type ArtistData,
  type ArtistInfo,
} from "@/components/artist/artist-model";
import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { ListenHeroActionBar } from "@/components/hero/ListenHeroActionBar";
import { cn, formatCompact } from "@/lib/utils";

interface ArtistHeroSectionProps {
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  backgroundUrl?: string;
  tags: string[];
  following: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistRadio: () => void;
  onPlaySetlist?: () => void;
  hasSetlist?: boolean;
  onToggleFollow: () => void;
  onShare: () => void;
  onOpenBio: () => void;
}

const ARTIST_SECONDARY_ACTION_CLASS = "text-2xs md:text-xs";

function withHeroCacheBust(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}v=artist-hero-bg-v1`;
}

export function ArtistHeroSection({
  artist,
  artistInfo,
  photoUrl,
  backgroundUrl,
  following,
  onPlay,
  onShuffle,
  onArtistRadio,
  onPlaySetlist,
  hasSetlist,
  onToggleFollow,
  onShare,
  onOpenBio,
}: ArtistHeroSectionProps) {
  const { t } = useTranslation();
  const bio = artistInfo?.bio ?? "";
  const heroBackgroundSrc = backgroundUrl
    ? withHeroCacheBust(backgroundUrl)
    : undefined;
  const mobileArtwork = photoUrl ? photoUrl : heroBackgroundSrc;
  const artworkClassName = `absolute inset-0 size-full scale-[1.02] ${artistHeroArtworkFitClassName()} object-[right_20%]`;
  const menuItems = useMemo(
    () =>
      buildArtistMenuItems({
        following,
        hasSetlist,
        onPlay,
        onShuffle,
        onRadio: onArtistRadio,
        onPlaySetlist,
        onToggleFollow,
        onShare,
        t,
      }),
    [
      following,
      hasSetlist,
      onArtistRadio,
      onPlay,
      onPlaySetlist,
      onShuffle,
      onShare,
      onToggleFollow,
      t,
    ],
  );

  return (
    <PageHero
      variant="artist"
      title={artist.name}
      titleClassName="mb-1 sm:mb-2"
      artwork={
        <CrateImage
          src={photoUrl}
          alt={artist.name}
          className="size-full object-cover"
        />
      }
      background={{
        overlay: <></>,
        render: () => (
          <>
            <div className="h-full sm:hidden">
              <ArtistHeroFrame
                composition="mobile"
                aspectRatio="auto"
                className="h-full"
                artwork={
                  mobileArtwork ? (
                    <CrateImage
                      src={mobileArtwork}
                      alt=""
                      className={`${artworkClassName} brightness-[0.72] contrast-110 opacity-[0.82]`}
                    />
                  ) : null
                }
              />
            </div>
            <div className="hidden h-full sm:block">
              <ArtistHeroFrame
                composition="desktop"
                aspectRatio="auto"
                className="h-full"
                artwork={
                  heroBackgroundSrc ? (
                    <CrateImage
                      src={heroBackgroundSrc}
                      alt=""
                      className={`${artworkClassName} grayscale brightness-[0.5] contrast-110 opacity-[0.45]`}
                    />
                  ) : null
                }
              />
            </div>
          </>
        ),
      }}
      meta={[
        artistInfo?.listeners ? (
          <span key="listeners" className="flex items-center gap-1">
            <Users size={CRATE_ICON_SIZE.xs} />
            {t("artist.meta.listeners", {
              count: formatCompact(artistInfo.listeners),
            })}
          </span>
        ) : null,
        artist.total_tracks > 0
          ? t("common.trackCountLabel", { count: artist.total_tracks })
          : null,
        artist.albums.length > 0
          ? t("common.albumCountLabel", { count: artist.albums.length })
          : null,
      ]}
      actions={
        <ListenHeroActionBar
          primaryLabel={t("artist.actions.primaryGroup")}
          secondaryLabel={t("artist.actions.secondaryGroup")}
          primaryActions={[
            {
              key: "play",
              label: t("player.play"),
              icon: <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />,
              onClick: onPlay,
              ariaLabel: t("player.play"),
            },
            {
              key: "shuffle",
              label: t("player.shuffle"),
              icon: <Shuffle size={CRATE_ICON_SIZE.md} />,
              tone: "neutral",
              onClick: onShuffle,
              ariaLabel: t("player.shuffle"),
            },
          ]}
          secondaryActions={[
            {
              key: "radio",
              label: t("radio.title"),
              icon: <Radio size={CRATE_ICON_SIZE.lg} />,
              onClick: onArtistRadio,
              ariaLabel: t("artist.actions.radio"),
              className: ARTIST_SECONDARY_ACTION_CLASS,
            },
            {
              key: "setlist",
              label: t("artist.actions.setlist"),
              icon: <ListMusic size={CRATE_ICON_SIZE.lg} />,
              onClick: onPlaySetlist,
              disabled: !hasSetlist,
              ariaLabel: t("artist.actions.setlist"),
              className: ARTIST_SECONDARY_ACTION_CLASS,
            },
          ]}
          secondaryExtra={
            <>
              <FollowHeartButton
                className={cn(
                  HERO_SECONDARY_ACTION_CLASS,
                  ARTIST_SECONDARY_ACTION_CLASS,
                  following && HERO_SECONDARY_ACTION_ACTIVE_CLASS,
                )}
                following={following}
                iconSize={CRATE_ICON_SIZE.lg}
                onClick={onToggleFollow}
                aria-label={
                  following ? t("common.unfollow") : t("common.follow")
                }
              >
                <span>
                  {following ? t("common.following") : t("common.follow")}
                </span>
              </FollowHeartButton>
              <button
                type="button"
                className={cn(
                  HERO_SECONDARY_ACTION_CLASS,
                  ARTIST_SECONDARY_ACTION_CLASS,
                )}
                onClick={onShare}
                aria-label={t("common.share")}
              >
                <Share2 size={CRATE_ICON_SIZE.lg} />
                <span>{t("common.share")}</span>
              </button>
              <BandcampSupportButton
                entityType="artist"
                entityUid={artist.entity_uid}
                presentation="secondary-action"
                className={ARTIST_SECONDARY_ACTION_CLASS}
              />
            </>
          }
          menu={{
            actions: menuItems,
            header: {
              type: "media",
              title: artist.name,
              subtitle: `${t("common.trackCountLabel", {
                count: artist.total_tracks,
              })} · ${t("common.albumCountLabel", {
                count: artist.albums.length,
              })}`,
              imageUrl: photoUrl,
              imageAlt: artist.name,
              imageShape: "circle",
              fallbackIcon: Users,
            },
          }}
        />
      }
    >
      {bio ? (
        <div className="mt-3 max-w-2xl">
          <p className="line-clamp-2 whitespace-pre-line text-sm leading-relaxed text-text-primary/70 sm:line-clamp-3">
            <ArtistBioText text={bio} />
          </p>
          {bio.length > 200 ? (
            <button
              type="button"
              className="link-accent mt-2 flex w-fit max-w-full items-center gap-1 text-xs"
              onClick={onOpenBio}
            >
              {t("common.showMore")}{" "}
              <ChevronDown size={CRATE_ICON_SIZE.micro} />
            </button>
          ) : null}
        </div>
      ) : null}
    </PageHero>
  );
}
