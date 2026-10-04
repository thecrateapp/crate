import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CRATE_ICON_SIZE,
  ListMusic,
  Play,
  Shuffle,
  type CrateIcon,
} from "@crate/ui/icons";
import { PageHero } from "@crate/ui/domain/hero";

import type { ContextMenuEntry } from "@/components/actions/ItemActionMenu";
import { ListenHeroActionBar } from "@/components/hero/ListenHeroActionBar";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface PlaylistHeroSecondaryAction {
  key: string;
  label: string;
  ariaLabel?: string;
  icon: CrateIcon;
  iconClassName?: string;
  className?: string;
  active?: boolean;
  pulseIcon?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

interface PlaylistHeroSectionProps {
  title: string;
  subtitle?: string;
  description?: string;
  metaItems: Array<string | null | undefined | false>;
  badges?: ReactNode;
  artwork: (className: string) => ReactNode;
  menuImageUrl?: string | null;
  menuImageAlt?: string;
  onPlay: () => void;
  onShuffle: () => void;
  playDisabled?: boolean;
  shuffleDisabled?: boolean;
  secondaryActions: PlaylistHeroSecondaryAction[];
  menuItems: ContextMenuEntry[];
}

export function PlaylistHeroSection({
  title,
  subtitle,
  description,
  metaItems,
  badges,
  artwork,
  menuImageUrl,
  menuImageAlt,
  onPlay,
  onShuffle,
  playDisabled,
  shuffleDisabled,
  secondaryActions,
  menuItems,
}: PlaylistHeroSectionProps) {
  const { t } = useTranslation();
  const visibleMetaItems = metaItems.filter(
    (item): item is string => typeof item === "string" && item !== "",
  );

  return (
    <PageHero
      variant="media"
      eyebrow={badges}
      title={title}
      description={description}
      meta={visibleMetaItems}
      artwork={artwork("size-full rounded-none")}
      background={{
        gradient: "strong",
        render: (className) => (
          <div className={className}>
            {artwork("h-full w-full rounded-none")}
          </div>
        ),
      }}
      actions={
        <ListenHeroActionBar
          primaryLabel={t("playlist.actions.primaryGroup")}
          secondaryLabel={t("playlist.actions.secondaryGroup")}
          primaryActions={[
            {
              key: "play",
              label: t("player.play"),
              icon: <Play size={17} fill="currentColor" />,
              onClick: onPlay,
              disabled: playDisabled,
              ariaLabel: t("player.play"),
            },
            {
              key: "shuffle",
              label: t("player.shuffle"),
              icon: <Shuffle size={17} />,
              tone: "neutral",
              onClick: onShuffle,
              disabled: shuffleDisabled,
              ariaLabel: t("player.shuffle"),
            },
          ]}
          secondaryActions={secondaryActions.map((action) => {
            const Icon = action.icon;
            return {
              key: action.key,
              label: action.label,
              ariaLabel: action.ariaLabel || action.label,
              title: action.title,
              active: action.active,
              disabled: action.disabled,
              className: action.className,
              onClick: action.onClick,
              icon: (
                <Icon
                  size={CRATE_ICON_SIZE.lg}
                  className={cn(
                    action.pulseIcon && "animate-crate-icon-active-pulse",
                    action.iconClassName,
                  )}
                />
              ),
            };
          })}
          menu={{
            actions: menuItems,
            header: {
              type: "media",
              title,
              subtitle,
              detail: visibleMetaItems[0] || undefined,
              imageUrl: resolveMaybeApiAssetUrl(menuImageUrl),
              imageAlt: menuImageAlt || title,
              imageShape: "square",
              fallbackIcon: ListMusic,
            },
          }}
        />
      }
    />
  );
}
