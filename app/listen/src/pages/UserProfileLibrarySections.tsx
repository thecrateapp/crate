import { Link } from "react-router";
import { CRATE_ICON_SIZE, Disc3, Music4, PackagePlus } from "@crate/ui/icons";
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
      meta={t("userProfile.contributions.via", { source })}
    />
  );
}

export function UserProfileLibrary({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  const contributions = data.contributions_preview || [];
  return (
    <section className="space-y-6">
      <div className="user-profile-card rounded-panel p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <PackagePlus
            size={CRATE_ICON_SIZE.sm}
            className="user-profile-accent-icon"
          />
          <h2 className="text-lg font-semibold text-text-primary">
            {t("userProfile.contributions.title")}
          </h2>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {t("userProfile.contributions.subtitle")}
        </p>
        <div className="mt-4 grid gap-1 sm:grid-cols-2">
          {contributions.length === 0 ? (
            <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-text-muted sm:col-span-2">
              {t("userProfile.contributions.empty")}
            </div>
          ) : (
            contributions
              .slice(0, 6)
              .map((contribution) => (
                <ContributionCard
                  key={contribution.id}
                  contribution={contribution}
                />
              ))
          )}
        </div>
      </div>
      <UserProfilePlaylists data={data} />
      <UserProfileCrates data={data} />
    </section>
  );
}

function UserProfileCrates({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  const crates = data.public_crates || [];

  return (
    <div className="user-profile-card rounded-panel p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Disc3 size={CRATE_ICON_SIZE.sm} className="user-profile-accent-icon" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("userProfile.crates.title")}
        </h2>
      </div>
      <div className="mt-4 space-y-3">
        {crates.length === 0 ? (
          <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-text-muted">
            {t("userProfile.crates.empty")}
          </div>
        ) : (
          crates.map((crate) => (
            <UserProfileCrateRow key={crate.id} crate={crate} />
          ))
        )}
      </div>
    </div>
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
    <div className="user-profile-item flex items-center gap-4 rounded-lg px-4 py-3">
      <Link
        to={cratePagePath(crate)}
        className="flex min-w-0 flex-1 items-center gap-4"
      >
        {coverUrl ? (
          <CrateImage
            src={coverUrl}
            alt={firstAlbum?.name ?? ""}
            className="size-14 rounded-xl object-cover"
          />
        ) : (
          <div className="user-profile-accent-panel user-profile-accent-icon flex size-14 items-center justify-center rounded-xl">
            <Disc3 size={CRATE_ICON_SIZE.lg} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text-primary">
            {crate.name}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {t("common.albumCountLabel", {
              count: crate.album_count,
            })}
            {crate.track_count
              ? ` · ${t("common.trackCountLabel", {
                  count: crate.track_count,
                })}`
              : ""}
            {crateFollow.followerCount > 0
              ? ` · ${t("common.followerCountLabel", {
                  count: crateFollow.followerCount,
                })}`
              : ""}
            {crate.is_collaborative
              ? ` · ${t("userProfile.crates.collaborative")}`
              : ""}
          </div>
          {crate.description ? (
            <div className="mt-1 truncate text-xs text-text-muted">
              {crate.description}
            </div>
          ) : null}
        </div>
      </Link>
      {canFollow ? (
        <CrateFollowButton
          followed={crateFollow.followed}
          pending={crateFollow.pending}
          onToggle={crateFollow.toggle}
          className="size-11 shrink-0 rounded-full border border-border-quiet text-text-muted hover:text-accent-action"
        />
      ) : null}
    </div>
  );
}

function UserProfilePlaylists({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <div className="user-profile-card rounded-panel p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Music4
          size={CRATE_ICON_SIZE.sm}
          className="user-profile-accent-icon"
        />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("userProfile.playlists.title")}
        </h2>
      </div>
      <div className="mt-4 space-y-3">
        {data.public_playlists.length === 0 ? (
          <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-text-muted">
            {t("userProfile.playlists.empty")}
          </div>
        ) : (
          data.public_playlists.map((playlist) => (
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
              className="user-profile-item"
            />
          ))
        )}
      </div>
    </div>
  );
}
