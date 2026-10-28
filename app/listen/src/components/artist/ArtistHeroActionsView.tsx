import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CRATE_ICON_SIZE,
  ListMusic,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "@crate/ui/icons";
import {
  HeroActionBar,
  HERO_SECONDARY_ACTION_ACTIVE_CLASS,
  HERO_SECONDARY_ACTION_CLASS,
  type HeroActionMenu,
} from "@crate/ui/domain/hero";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { cn } from "@crate/ui/lib/cn";
/** Production composition; API/menu media transport and Bandcamp authority are injected. */
export function ArtistHeroActionsView({
  following,
  hasSetlist,
  onPlay,
  onShuffle,
  onArtistRadio,
  onPlaySetlist,
  onToggleFollow,
  onShare,
  menu,
  supportAction,
  mobileMenuPortal,
}: {
  following: boolean;
  hasSetlist?: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistRadio: () => void;
  onPlaySetlist?: () => void;
  onToggleFollow: () => void;
  onShare: () => void;
  menu?: HeroActionMenu;
  supportAction?: ReactNode;
  mobileMenuPortal?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <HeroActionBar
      mobileMenuPortal={mobileMenuPortal}
      moreLabel={t("common.more")}
      menu={menu}
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
        },
        {
          key: "setlist",
          label: t("artist.actions.setlist"),
          icon: <ListMusic size={CRATE_ICON_SIZE.lg} />,
          onClick: onPlaySetlist,
          disabled: !hasSetlist,
          ariaLabel: t("artist.actions.setlist"),
        },
      ]}
      secondaryExtra={
        <>
          <FollowHeartButton
            className={cn(
              HERO_SECONDARY_ACTION_CLASS,
              following && HERO_SECONDARY_ACTION_ACTIVE_CLASS,
            )}
            following={following}
            iconSize={CRATE_ICON_SIZE.lg}
            onClick={onToggleFollow}
            aria-label={following ? t("common.unfollow") : t("common.follow")}
          >
            <MonoLabel as="span" className="text-inherit">
              {following ? t("common.following") : t("common.follow")}
            </MonoLabel>
          </FollowHeartButton>
          <button
            type="button"
            className={HERO_SECONDARY_ACTION_CLASS}
            onClick={onShare}
            aria-label={t("common.share")}
          >
            <Share2 size={CRATE_ICON_SIZE.lg} />
            <MonoLabel as="span" className="text-inherit">
              {t("common.share")}
            </MonoLabel>
          </button>
          {supportAction}
        </>
      }
    />
  );
}
