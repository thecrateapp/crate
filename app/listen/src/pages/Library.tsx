import { useCallback, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useApi } from "@/hooks/use-api";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { PullIndicator } from "@crate/ui/primitives/PullIndicator";
import { PageHeader } from "@crate/ui/domain/navigation";
import {
  CollectionTabs,
  COLLECTION_SECTIONS,
} from "@/components/layout/CollectionTabs";
import { useTabParam } from "@/hooks/use-tab-param";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import {
  LibraryAlbumsTab,
  LibraryArtistsTab,
  LibraryLikedTab,
} from "./LibraryCollectionTabs";
import { LibraryContributionsTab } from "./LibraryContributionsTab";
import { LibraryPlaylistsTab } from "./LibraryPlaylistsTab";
import { Crates } from "@/pages/Crates";

type Tab =
  | "playlists"
  | "artists"
  | "albums"
  | "liked"
  | "crates"
  | "contributions";

interface MeStats {
  followed_artists: number;
  saved_albums: number;
  liked_tracks: number;
  playlists: number;
  crates: number;
}

const tabs: { key: Tab; labelKey: string }[] = [
  { key: "artists", labelKey: "nav.collection.artists" },
  { key: "crates", labelKey: "nav.collection.crates" },
  { key: "playlists", labelKey: "nav.collection.playlists" },
  { key: "albums", labelKey: "nav.collection.albums" },
  { key: "liked", labelKey: "library.tabs.liked" },
  { key: "contributions", labelKey: "nav.collection.contributions" },
];

const tabTitleKeys: Record<Tab, string> = {
  playlists: "nav.collection",
  artists: "nav.collection.artists",
  albums: "nav.collection.albums",
  liked: "nav.collection.likedTracks",
  crates: "nav.collection.crates",
  contributions: "nav.collection.contributions",
};

export function Library() {
  const location = useLocation();
  const { section } = useParams<{ section?: string }>();
  const query = new URLSearchParams(location.search);
  if (section === "bandcamp" || (!section && query.get("tab") === "bandcamp")) {
    query.delete("tab");
    const search = query.toString();
    return (
      <Navigate
        replace
        to={{
          pathname: "/bandcamp",
          search: search ? `?${search}` : "",
          hash: location.hash,
        }}
        state={location.state}
      />
    );
  }
  return <LibraryContent />;
}

function LibraryContent() {
  const { t } = useTranslation();
  const { section } = useParams<{ section?: string }>();
  const isDesktop = useIsDesktop();
  const { data: stats, refetch: refetchStats } = useApi<MeStats>(
    isDesktop ? "/api/me" : null,
  );
  const [tab, setTab] = useTabParam(COLLECTION_SECTIONS, "playlists", {
    path: section
      ? { value: section, pathname: (next) => `/collection/${next}` }
      : undefined,
  });
  const counts: Partial<Record<Tab, number>> = stats
    ? {
        artists: stats.followed_artists,
        albums: stats.saved_albums,
        liked: stats.liked_tracks,
        playlists: stats.playlists,
        crates: stats.crates ?? 0,
      }
    : {};
  const [refreshKey, setRefreshKey] = useState(0);

  const onRefresh = useCallback(async () => {
    refetchStats();
    setRefreshKey((k) => k + 1);
  }, [refetchStats]);

  const {
    handlers: pullHandlers,
    pullDistance,
    refreshing,
  } = usePullToRefresh(onRefresh);

  return (
    <div className="space-y-6" {...pullHandlers}>
      <PullIndicator distance={pullDistance} refreshing={refreshing} />
      {/* Header */}
      <PageHeader
        size="md"
        title={isDesktop ? t("library.title.desktop") : t(tabTitleKeys[tab])}
      />

      <CollectionTabs
        value={tab}
        onValueChange={setTab}
        visible={isDesktop}
        label={t("library.tabs.label")}
        items={tabs.map(({ key, labelKey }) => ({
          value: key,
          label: t(labelKey),
          count: counts[key],
        }))}
      >
        {tab === "playlists" && <LibraryPlaylistsTab key={refreshKey} />}
        {tab === "artists" && <LibraryArtistsTab key={refreshKey} />}
        {tab === "albums" && <LibraryAlbumsTab key={refreshKey} />}
        {tab === "liked" && <LibraryLikedTab key={refreshKey} />}
        {tab === "crates" && (
          <Crates key={refreshKey} onCrateChange={refetchStats} />
        )}
        {tab === "contributions" && (
          <LibraryContributionsTab key={refreshKey} />
        )}
      </CollectionTabs>
    </div>
  );
}
