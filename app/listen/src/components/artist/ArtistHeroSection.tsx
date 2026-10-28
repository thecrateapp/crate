import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Users } from "@crate/ui/icons";
import { ArtistHeroActionsView } from "./ArtistHeroActionsView";
import { buildArtistMenuItems } from "@/components/actions/artist-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  type ArtistData,
  type ArtistInfo,
} from "@/components/artist/artist-model";
import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { ArtistHeroView } from "./ArtistHeroView";

export interface ArtistHeroSectionProps {
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
    <ArtistHeroView
      name={artist.name}
      bio={artistInfo?.bio ?? ""}
      listeners={artistInfo?.listeners}
      trackCount={artist.total_tracks}
      albumCount={artist.albums.length}
      photoUrl={photoUrl}
      backgroundUrl={
        backgroundUrl
          ? `${backgroundUrl}${backgroundUrl.includes("?") ? "&" : "?"}v=artist-hero-bg-v1`
          : undefined
      }
      renderImage={(props) => <CrateImage {...props} />}
      onOpenBio={onOpenBio}
      actions={
        <ArtistHeroActionsView
          following={following}
          hasSetlist={hasSetlist}
          onPlay={onPlay}
          onShuffle={onShuffle}
          onArtistRadio={onArtistRadio}
          onPlaySetlist={onPlaySetlist}
          onToggleFollow={onToggleFollow}
          onShare={onShare}
          supportAction={
            <BandcampSupportButton
              entityType="artist"
              entityUid={artist.entity_uid}
              presentation="secondary-action"
            />
          }
          menu={{
            sheetLabel: t("actions.menu.sheetLabel"),
            renderMediaImage: ({ src, ...props }) => (
              <CrateImage {...props} source={src} />
            ),
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
    />
  );
}
