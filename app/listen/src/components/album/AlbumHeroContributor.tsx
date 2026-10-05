import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, User } from "@crate/ui/icons";

import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import type { AlbumContributor, AlbumData } from "@/pages/album-types";

export function AlbumHeroContributor({
  data,
  visibleContributor,
  primaryContributorName,
  primaryContributorPath,
  primaryContributorSource,
  onGenreSelect,
}: {
  data: AlbumData;
  visibleContributor: AlbumContributor | null;
  primaryContributorName: string | null;
  primaryContributorPath: string | null;
  primaryContributorSource: string | null;
  onGenreSelect: (item: GenreProfileItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {visibleContributor ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
          <ArtworkSurface
            source={visibleContributor.user_avatar || null}
            alt=""
            className="size-6 shrink-0 rounded-full bg-text-primary/8 ring-1 ring-text-primary/10"
            imageClassName="object-cover"
            fallback={
              <span className="flex size-full items-center justify-center">
                <User size={CRATE_ICON_SIZE.xs} />
              </span>
            }
          />
          <span>
            {t("album.contributor.addedBy")}{" "}
            {primaryContributorPath ? (
              <UserProfileLink
                username={visibleContributor.user_username}
                to={primaryContributorPath}
                className="link-meta font-medium text-text-primary/85"
              >
                {primaryContributorName}
              </UserProfileLink>
            ) : (
              <span className="font-medium text-text-primary/85">
                {primaryContributorName}
              </span>
            )}
            {primaryContributorSource ? (
              <span className="text-text-muted/70">
                {" "}
                {t("album.contributor.via", {
                  source: primaryContributorSource,
                })}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {data.genre_profile && data.genre_profile.length > 0 ? (
        <GenrePillRow
          items={data.genre_profile}
          max={6}
          className="mt-3 hidden sm:flex"
          onSelect={onGenreSelect}
        />
      ) : null}
    </>
  );
}
