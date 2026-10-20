import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { PageHeader } from "@crate/ui/domain/navigation";
import { StatsPageView } from "./StatsPageView";
import { Button } from "@crate/ui/shadcn/button";

import { CrateImage } from "@/components/artwork/CrateImage";
import { StatsDecadeColumns } from "@/components/stats/StatsClosingCards";
import { type StatsArtistOfPeriod } from "@/components/stats/stats-model";
import {
  DiggingStory,
  type DiggingChapter,
} from "@/components/stats/digging/DiggingStory";
import { useAuth } from "@/contexts/AuthContext";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { openShareSheet } from "@/lib/social-share";
import {
  formatMonthTitle,
  statsDashboardReadState,
  selectionDays,
  selectionYear,
} from "@/pages/stats-page-model";
import {
  useStatsPageController,
  type StatsPageController,
} from "@/pages/use-stats-page-controller";

import {
  buildDiggingChapters,
  type DiggingMedia,
} from "../components/stats/digging/build-digging-chapters";
const media: DiggingMedia = {
  albumCover,
  renderImage: (src) => <CrateImage src={src} alt="" />,
  renderArtist: (artist: StatsArtistOfPeriod) => (
    <CrateImage
      src={artistPhotoApiUrl(
        {
          artistId: artist.artist_id,
          globalArtistUid: artist.global_artist_uid,
          artistSlug: artist.artist_slug,
          artistName: artist.artist_name,
        },
        { size: 1024 },
      )}
      alt=""
      className="stats-digging-artist-photo"
    />
  ),
  renderDecades: (musicAge) => (
    <StatsDecadeColumns musicAge={musicAge} className="stats-digging-decades" />
  ),
};

function periodLabel(page: StatsPageController, locale: string): string {
  const { t } = page;
  if (page.selectedMonth) return formatMonthTitle(page.selectedMonth, locale);
  const year = selectionYear(page.selection);
  if (year !== null) return String(year);
  const days = selectionDays(page.selection);
  if (days !== null) return t("stats.digging.lastDays", { count: days });
  return t("stats.window.allTime");
}

function albumCover(
  item: {
    album?: string | null;
    artist?: string | null;
    album_id?: number | null;
    global_album_uid?: string | null;
  },
  size = 512,
): string | null {
  if (!item.album) return null;
  return albumCoverApiUrl(
    {
      albumId: item.album_id,
      globalAlbumUid: item.global_album_uid,
      albumName: item.album,
      artistName: item.artist,
    },
    { size },
  );
}

export function StatsDigging() {
  const page = useStatsPageController();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const { dashboard, t } = page;
  const label = periodLabel(page, i18n.language);
  const kicker = t("stats.digging.kicker", { period: label });
  const owner =
    user?.instagram_handle?.trim() || user?.username || user?.name || "Crate";

  const chapters = useMemo<DiggingChapter[]>(
    () =>
      dashboard
        ? buildDiggingChapters(dashboard, t, kicker, owner, media, (share) =>
            openShareSheet({
              kind: "digging",
              title: kicker,
              subtitle: share.headline,
              url: window.location.href,
              imageUrl: share.coverUrls[0] ?? null,
              digging: share,
            }),
          )
        : [],
    [dashboard, kicker, owner, t],
  );

  const close = () => navigate(`/stats${window.location.search}`);

  if (!dashboard || !dashboard.overview.play_count || !chapters.length) {
    return (
      <StatsPageView
        header={
          <PageHeader
            title={t("stats.digging.label")}
            actions={
              <Button variant="outline" onClick={close}>
                {t("stats.digging.close")}
              </Button>
            }
          />
        }
        readState={statsDashboardReadState(
          dashboard,
          page.dashboardLoading,
          page.dashboardError,
        )}
        empty
        onRetry={page.retryDashboard}
      />
    );
  }
  return <DiggingStory chapters={chapters} onClose={close} />;
}
