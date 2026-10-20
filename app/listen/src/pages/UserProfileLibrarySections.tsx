import { CrateBox } from "@crate/ui/icons";
import { EntityRow } from "@crate/ui/domain/entity";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { CrateAlbumListItem } from "@/components/crates/CrateAlbumListView";
import { UserProfileLibraryView } from "./UserProfileLibraryView";
import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { CrateFollowButton } from "@/components/crates/CrateFollowButton";
import { contributionSourceLabel } from "@/lib/contributions";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { formatTotalDuration } from "@/lib/utils";

import type { ProfileContribution, PublicProfile } from "./user-profile-model";
import type { PublicCrate } from "./crates-types";
import { cratePagePath } from "@/components/crates/crate-model";
import { useCrateFollow } from "@/components/crates/use-crate-follow";

function ContributionCard({
  contribution,
}: {
  contribution: ProfileContribution;
}) {
  const { t } = useTranslation();
  const coverUrl =
    contribution.album_id && contribution.has_cover
      ? albumCoverApiUrl(
          {
            albumId: contribution.album_id,
            albumEntityUid: contribution.album_entity_uid,
            artistName: contribution.artist_name,
            albumName: contribution.album_name,
          },
          { size: 128 },
        )
      : undefined;
  const source =
    contributionSourceLabel(contribution.source) ||
    t("userProfile.contributions.source.library");

  return (
    <AlbumCard
      variant="row"
      artist={contribution.artist_name}
      album={contribution.album_name}
      albumId={contribution.album_id ?? undefined}
      albumEntityUid={contribution.album_entity_uid ?? undefined}
      albumSlug={contribution.album_slug ?? undefined}
      cover={coverUrl}
      meta={
        <MonoLabel as="span">
          {t("userProfile.contributions.via", { source })}
        </MonoLabel>
      }
    />
  );
}

export function UserProfileLibrary({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <UserProfileLibraryView
      contributions={
        data.contributions_preview?.length ? (
          <div className="grid min-w-0 gap-1">
            {data.contributions_preview.slice(0, 6).map((contribution) => (
              <ContributionCard
                key={contribution.id}
                contribution={contribution}
              />
            ))}
          </div>
        ) : null
      }
      playlists={
        data.public_playlists.length ? (
          <div className="grid min-w-0 divide-y divide-border-quiet">
            {data.public_playlists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                variant="row"
                playlistId={playlist.id}
                name={playlist.name}
                description={playlist.description ?? undefined}
                coverDataUrl={playlist.cover_data_url}
                trackCount={playlist.track_count}
                meta={[
                  playlist.total_duration > 0
                    ? formatTotalDuration(playlist.total_duration)
                    : null,
                  playlist.is_collaborative
                    ? t("userProfile.playlists.collaborative")
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                href={`/playlist/${playlist.id}`}
                detailEndpoint={`/api/playlists/${playlist.id}`}
              />
            ))}
          </div>
        ) : null
      }
      crates={
        data.public_crates?.length ? (
          <ol className="grid min-w-0 divide-y divide-border-quiet">
            {data.public_crates.map((crate) => (
              <CrateAlbumListItem key={crate.id}>
                <UserProfileCrateRow crate={crate} />
              </CrateAlbumListItem>
            ))}
          </ol>
        ) : null
      }
    />
  );
}

function UserProfileCrateRow({ crate }: { crate: PublicCrate }) {
  const { t } = useTranslation();
  const firstAlbum = crate.first_album;
  const coverUrl = firstAlbum?.has_cover
    ? albumCoverApiUrl(
        {
          globalAlbumUid: firstAlbum.global_album_uid,
          albumName: firstAlbum.name,
          artistName: firstAlbum.artist_name,
        },
        { size: 192 },
      )
    : null;
  const canFollow = crate.access === "public";
  const crateFollow = useCrateFollow({
    crateId: crate.id,
    initialFollowed: crate.is_followed ?? false,
    initialFollowerCount: crate.follower_count ?? 0,
    enabled: canFollow,
  });

  return (
    <EntityRow
      title={crate.name}
      href={cratePagePath(crate)}
      leading={
        <MediaCover
          alt=""
          src={coverUrl}
          className="size-14"
          fallbackIcon={CrateBox}
          renderImage={(image) => <CrateImage {...image} />}
        />
      }
      subtitle={crate.description || undefined}
      meta={
        <MonoLabel as="span">
          {[
            t("common.albumCountLabel", { count: crate.album_count }),
            crate.track_count
              ? t("common.trackCountLabel", { count: crate.track_count })
              : null,
            crateFollow.followerCount > 0
              ? t("common.followerCountLabel", {
                  count: crateFollow.followerCount,
                })
              : null,
            crate.is_collaborative
              ? t("userProfile.crates.collaborative")
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </MonoLabel>
      }
      trailing={
        canFollow ? (
          <CrateFollowButton
            followed={crateFollow.followed}
            pending={crateFollow.pending}
            onToggle={crateFollow.toggle}
          />
        ) : undefined
      }
    />
  );
}
