import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  analyzeSource,
  buildInventory,
  type IconEntry,
} from "../../../scripts/design-system/admin-icon-inventory.mjs";

const repo = resolve(process.cwd(), "../..");
// Artist/Album migration, 2026-10-23: concrete domain files are audited directly.
// Includes their existing artwork framing/crop tools; Nivo and Canvas instruments
// remain external visuals, while real action/search/disclosure/busy glyphs are bounded.
const libraryScope = [
  "app/ui/src/pages/Artist.tsx",
  "app/ui/src/pages/Album.tsx",
  "app/ui/src/components/ImageCropUpload.tsx",
  "app/ui/src/components/scanner/MatchCard.tsx",
  "app/ui/src/components/artist/ArtistArtworkGallery.tsx",
  "app/ui/src/components/artist/ArtistArtworkSection.tsx",
  "app/ui/src/components/artist/ArtistAvatar.tsx",
  "app/ui/src/components/artist/ArtistBioResearchAction.tsx",
  "app/ui/src/components/artist/ArtistBioResearchDialog.tsx",
  "app/ui/src/components/artist/ArtistCard.tsx",
  "app/ui/src/components/artist/ArtistDiscographySection.tsx",
  "app/ui/src/components/artist/ArtistGenreSelector.tsx",
  "app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx",
  "app/ui/src/components/artist/ArtistHeroSection.tsx",
  "app/ui/src/components/artist/ArtistLoadingState.tsx",
  "app/ui/src/components/artist/ArtistMetadataEditor.tsx",
  "app/ui/src/components/artist/ArtistNetworkGraph.tsx",
  "app/ui/src/components/artist/network/ArtistNetworkInspector.tsx",
  "app/ui/src/components/artist/ArtistOverviewSection.tsx",
  "app/ui/src/components/artist/ArtistPageBits.tsx",
  "app/ui/src/components/artist/ArtistRepairDialog.tsx",
  "app/ui/src/components/artist/ArtistRow.tsx",
  "app/ui/src/components/artist/ArtistSetlistSection.tsx",
  "app/ui/src/components/artist/ArtistShowsSection.tsx",
  "app/ui/src/components/artist/ArtistSimilarSection.tsx",
  "app/ui/src/components/artist/ArtistStats.tsx",
  "app/ui/src/components/artist/ArtistStatsSummary.tsx",
  "app/ui/src/components/artist/ArtistStatsSection.tsx",
  "app/ui/src/components/charts/InstrumentChart.tsx",
  "app/ui/src/components/system-health/MetricChart.tsx",
  "app/ui/src/components/artist/ArtistTabsNav.tsx",
  "app/ui/src/components/artist/ArtistTopTracksSection.tsx",
  "app/ui/src/components/artist/HeroCompositionCanvas.tsx",
  "app/ui/src/components/album/AlbumCard.tsx",
  "app/ui/src/components/album/AlbumGrid.tsx",
  "app/ui/src/components/album/AlbumHeader.tsx",
  "app/ui/src/components/album/AlbumRow.tsx",
  "app/ui/src/components/album/AudioProfileCard.tsx",
  "app/ui/src/components/album/MissingAlbumCard.tsx",
  "app/ui/src/components/album/RelatedAlbums.tsx",
  "app/ui/src/components/album/TagEditor.tsx",
  "app/ui/src/components/album/TidalAlbumCard.tsx",
  "app/ui/src/components/album/TrackTable.tsx",
];
const supportingScope = [
  "app/ui/src/pages/Insights.tsx",
  "app/ui/src/components/insights/InsightComparison.tsx",
  "app/ui/src/components/insights/InsightTimeline.tsx",
  "app/ui/src/components/insights/InsightSummary.tsx",
  "app/ui/src/components/insights/InsightEntityLists.tsx",
  "app/ui/src/components/insights/InsightSonicExplorer.tsx",
  "app/ui/src/components/insights/InsightSonicReading.tsx",
  "app/ui/src/components/layout/HeaderUserMenu.tsx",
  "app/ui/src/components/admin/ListPagination.tsx",
  "app/ui/src/components/SmartMixCoverage.tsx",
  "app/ui/src/components/SmartMixActivity.tsx",
  "app/ui/src/components/SmartMixTracks.tsx",
  "app/ui/src/components/admin/QueueLanes.tsx",
  "app/ui/src/components/admin/RelativeTime.tsx",
  "app/ui/src/pages/agents/Agents.tsx",
];
const scope = ["Sidebar", "CommandPalette", "Shell", "SearchBar"]
  .map((name) => `app/ui/src/components/layout/${name}.tsx`)
  .concat(
    [
      "app/ui/src/components/ui/AIButton.tsx",
      "app/ui/src/components/ui/AdminSelect.tsx",
      "app/ui/src/components/admin/ops-surfaces.tsx",
      "app/ui/src/components/layout/PageHeader.tsx",
      "app/ui/src/pages/Logs.tsx",
      "app/ui/src/pages/Stack.tsx",
      "app/ui/src/pages/Analysis.tsx",
      "app/ui/src/pages/Dashboard.tsx",
      "app/ui/src/pages/SystemHealth.tsx",
      "app/ui/src/pages/Health.tsx",
      "app/ui/src/pages/Trash.tsx",
      "app/ui/src/pages/Contributions.tsx",
      "app/ui/src/pages/Bandcamp.tsx",
      "app/ui/src/pages/Discover.tsx",
      "app/ui/src/pages/NewReleases.tsx",
      "app/ui/src/pages/GlobalCatalog.tsx",
      "app/ui/src/pages/Roles.tsx",
      "app/ui/src/pages/Users.tsx",
      "app/ui/src/pages/I18nReview.tsx",
      "app/ui/src/pages/Upcoming.tsx",
      "app/ui/src/pages/Playlists.tsx",
      "app/ui/src/pages/PlaylistEditor.tsx",
      "app/ui/src/components/playlists/PlaylistArtwork.tsx",
      "app/ui/src/components/playlists/PlaylistEditorTrackList.tsx",
      "app/ui/src/components/shows/ShowCard.tsx",
      "app/ui/src/components/shows/ShowManagementRow.tsx",
      "app/ui/src/components/shows/AddShowButton.tsx",
      "app/ui/src/components/shows/MergeShowsButton.tsx",
      "app/ui/src/pages/Imports.tsx",
    ],
    libraryScope,
    supportingScope,
  );
// Reviewed shared Select contract: disclosure, option selection and search glyphs are UX.
// The Admin wrapper itself is checked directly; no arbitrary wrapper or icon prop is exempt.
const approvedControls = new Map([
  [
    "app/ui/src/pages/Insights.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  // Reviewed composition owns no glyph; its shared primitives are scanned directly.
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 4 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Analysis.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 5 },
  ],
  [
    "app/ui/src/pages/SystemHealth.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Trash.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Contributions.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Discover.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 3 },
  ],
  [
    "app/ui/src/pages/GlobalCatalog.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 3 },
  ],
  [
    "app/ui/src/pages/I18nReview.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Logs.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 5 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@/components/admin/StackMap",
    { component: "StackMap", limit: 1 },
  ],
  [
    "app/ui/src/pages/Health.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/pages/Bandcamp.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 3 },
  ],
  [
    "app/ui/src/pages/NewReleases.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 3 },
  ],
  [
    "app/ui/src/pages/Users.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 5 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/shows/AddShowButton",
    { component: "AddShowButton", limit: 1 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/shows/MergeShowsButton",
    { component: "MergeShowsButton", limit: 1 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/shows/MergeShowsSheet",
    { component: "MergeShowsSheet", limit: 1 },
  ],
  [
    "app/ui/src/components/shows/AddShowButton.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/components/shows/AddShowButton.tsx:./AddShowSheet",
    { component: "AddShowSheet", limit: 1 },
  ],
  [
    "app/ui/src/components/shows/MergeShowsButton.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 1 },
  ],
  [
    "app/ui/src/components/shows/MergeShowsButton.tsx:./MergeShowsSheet",
    { component: "MergeShowsSheet", limit: 1 },
  ],
  [
    "app/ui/src/pages/Imports.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 2 },
  ],
  [
    "app/ui/src/pages/Imports.tsx:@crate/ui/shadcn/button",
    { component: "Button", limit: 3 },
  ],
  [
    "app/ui/src/pages/Imports.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@/components/layout/PageHeader",
    { component: "PageHeaderAction", limit: 5 },
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 7 },
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/ui/AIButton",
    { component: "AIButton", limit: 2 },
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/playlists/PlaylistArtwork",
    { component: "PlaylistArtwork", limit: 2 },
  ],

  [
    "app/ui/src/pages/Playlists.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 8 },
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@/components/playlists/PlaylistArtwork",
    { component: "PlaylistArtwork", limit: 1 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 2 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/shows/ShowCard",
    { component: "ShowCard", limit: 2 },
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/shows/ShowManagementRow",
    { component: "ShowManagementRow", limit: 1 },
  ],
  [
    "app/ui/src/pages/Users.tsx:@crate/ui/shadcn/dialog",
    { component: "DialogContent", limit: 4 },
  ],
  [
    "app/ui/src/pages/Users.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/pages/NewReleases.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/NewReleases.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 2 },
  ],
  [
    "app/ui/src/pages/Discover.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Trash.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 2 },
  ],
  [
    "app/ui/src/pages/Health.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Health.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/primitives/AppModal",
    { component: "AppModal", limit: 1 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 2 },
  ],
  [
    "app/ui/src/pages/Analysis.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 2 },
  ],
  [
    "app/ui/src/pages/Logs.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 2 },
  ],
  [
    "app/ui/src/pages/Logs.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 2 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/components/layout/Sidebar.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 1 },
  ],
]);
// Each shared catalogue export and domain composition is registered separately.
// A module exporting ActionButton and ActionLink is not a blanket glyph exemption:
// direct children and icon props remain independently audited, opaque spreads fail,
// and each exact path/source/export may appear only this many times in source.
const approvedLibraryControls = new Map<string, number>([
  [
    "app/ui/src/pages/Insights.tsx:@/components/insights/InsightEntityLists:InsightOpportunities",
    1,
  ],
  [
    "app/ui/src/pages/Insights.tsx:@/components/insights/InsightSonicExplorer:InsightSonicExplorer",
    1,
  ],
  [
    "app/ui/src/components/insights/InsightSonicExplorer.tsx:@/components/charts/InstrumentChart:InstrumentChartLegend",
    1,
  ],
  [
    "app/ui/src/components/insights/InsightSonicExplorer.tsx:./InsightSonicReading:InsightSonicReading",
    1,
  ],
  [
    "app/ui/src/components/insights/InsightComparison.tsx:@/components/charts/InstrumentChart:InstrumentChartLegend",
    1,
  ],
  [
    "app/ui/src/components/insights/InsightTimeline.tsx:@/components/charts/InstrumentChart:InstrumentChartLegend",
    1,
  ],
  [
    "app/ui/src/pages/Insights.tsx:@crate/ui/composites/AdminSelect:AdminSelect",
    1,
  ],
  [
    "app/ui/src/pages/Insights.tsx:@/components/insights/InsightComparison:InsightComparison",
    1,
  ],
  [
    "app/ui/src/pages/Insights.tsx:@/components/insights/InsightTimeline:InsightTimeline",
    1,
  ],
  // 24 October review: recovery states and functional graph/calendar actions.
  [
    "app/ui/src/components/album/TrackTable.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistNetworkGraph.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    2,
  ],
  [
    "app/ui/src/components/artist/ArtistNetworkGraph.tsx:./network/ArtistNetworkInspector:ArtistNetworkInspector",
    1,
  ],
  [
    "app/ui/src/components/artist/network/ArtistNetworkInspector.tsx:@crate/ui/domain/genres/GenrePill:GenrePillRow",
    1,
  ],
  [
    "app/ui/src/components/artist/network/ArtistNetworkInspector.tsx:@crate/ui/shadcn/button:Button",
    3,
  ],
  [
    "app/ui/src/components/artist/ArtistSimilarSection.tsx:@/components/artist/ArtistNetworkGraph:ArtistNetworkGraph",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistStatsSection.tsx:@/components/artist/ArtistNetworkGraph:ArtistNetworkGraph",
    1,
  ],
  [
    "app/ui/src/components/shows/ShowCard.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/shows/ShowCard.tsx:@crate/ui/primitives/ActionGroup:ActionLink",
    2,
  ],
  [
    "app/ui/src/components/shows/ShowCard.tsx:@crate/ui/domain/genres/GenrePill:GenrePillRow",
    1,
  ],
  [
    "app/ui/src/pages/GlobalCatalog.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    2,
  ],
  [
    "app/ui/src/pages/I18nReview.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    1,
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    4,
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    1,
  ],
  ["app/ui/src/pages/Users.tsx:@crate/ui/primitives/ErrorState:ErrorState", 1],
  // Final review: exact shared controls and locally composed surfaces, all bounded.
  // PlaylistEditor: retry/disclosure/busy controls, with child glyphs audited below.
  ["app/ui/src/pages/PlaylistEditor.tsx:@crate/ui/domain/states:ErrorState", 3],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@crate/ui/domain/navigation/BackLink:BackLink",
    2,
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/admin/ops-surfaces:OpsRefreshNotice",
    1,
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    3,
  ],
  ["app/ui/src/pages/PlaylistEditor.tsx:@crate/ui/shadcn/button:Button", 7],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  // Shared search fields: the search and clear glyphs belong to SearchInput.
  [
    "app/ui/src/components/SmartMixTracks.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/components/album/TrackTable.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistGenreSelector.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/Album.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    2,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/Discover.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/Download.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/Genres.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  ["app/ui/src/pages/Logs.tsx:@crate/ui/primitives/SearchInput:SearchInput", 1],
  [
    "app/ui/src/pages/NewReleases.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/Stack.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/Tasks.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@crate/ui/primitives/SearchInput:SearchInput",
    1,
  ],
  [
    "app/ui/src/pages/PlaylistEditor.tsx:@/components/playlists/PlaylistEditorTrackList:PlaylistEditorTrackList",
    1,
  ],
  [
    "app/ui/src/components/playlists/PlaylistEditorTrackList.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    3,
  ],
  ["app/ui/src/components/ui/AIButton.tsx:@crate/ui/shadcn/button:Button", 1],
  [
    "app/ui/src/components/layout/Shell.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  ["app/ui/src/components/layout/Shell.tsx:./HeaderUserMenu:HeaderUserMenu", 2],
  [
    "app/ui/src/components/layout/Shell.tsx:@crate/ui/primitives/AppModal:AppModal",
    1,
  ],
  [
    "app/ui/src/pages/Analysis.tsx:@/components/admin/ops-surfaces:OpsRefreshNotice",
    1,
  ],
  [
    "app/ui/src/pages/Analysis.tsx:@/components/SmartMixCoverage:SmartMixCoverage",
    1,
  ],
  [
    "app/ui/src/pages/Bandcamp.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    2,
  ],
  [
    "app/ui/src/pages/Discover.tsx:@/components/admin/ops-surfaces:OpsRefreshNotice",
    1,
  ],
  [
    "app/ui/src/pages/Health.tsx:@/components/admin/ops-surfaces:OpsRefreshNotice",
    1,
  ],
  [
    "app/ui/src/pages/I18nReview.tsx:@/components/ui/AdminSelect:AdminSelect",
    1,
  ],
  [
    "app/ui/src/pages/Logs.tsx:@/components/admin/ops-surfaces:OpsRefreshNotice",
    1,
  ],
  [
    "app/ui/src/pages/NewReleases.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    3,
  ],
  [
    "app/ui/src/pages/NewReleases.tsx:@/components/admin/ListPagination:ListPagination",
    1,
  ],
  [
    "app/ui/src/pages/Playlists.tsx:@/components/admin/ListPagination:ListPagination",
    1,
  ],
  [
    "app/ui/src/pages/Stack.tsx:@/components/admin/ops-surfaces:OpsRefreshNotice",
    1,
  ],
  [
    "app/ui/src/pages/SystemHealth.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    1,
  ],
  [
    "app/ui/src/pages/SystemHealth.tsx:@/components/admin/ops-surfaces:OpsRefreshNotice",
    1,
  ],
  ["app/ui/src/pages/Trash.tsx:@crate/ui/primitives/ErrorState:ErrorState", 1],
  [
    "app/ui/src/pages/Trash.tsx:@/components/admin/ops-surfaces:OpsRefreshNotice",
    1,
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@/components/admin/ListPagination:ListPagination",
    1,
  ],
  [
    "app/ui/src/pages/Upcoming.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    2,
  ],
  [
    "app/ui/src/components/shows/ShowManagementRow.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/shows/ShowManagementRow.tsx:@crate/ui/primitives/ActionGroup:ActionLink",
    4,
  ],
  [
    "app/ui/src/components/shows/ShowManagementRow.tsx:@crate/ui/domain/genres/GenrePill:GenrePillRow",
    1,
  ],
  [
    "app/ui/src/components/SmartMixCoverage.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    1,
  ],
  [
    "app/ui/src/components/SmartMixCoverage.tsx:@/components/SmartMixActivity:SmartMixActivity",
    1,
  ],
  [
    "app/ui/src/components/SmartMixCoverage.tsx:@/components/SmartMixTracks:SmartMixTracks",
    1,
  ],
  [
    "app/ui/src/components/SmartMixTracks.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    1,
  ],

  [
    "app/ui/src/components/ImageCropUpload.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/ImageCropUpload.tsx:@crate/ui/primitives/AppModal:AppModal",
    1,
  ],
  [
    "app/ui/src/components/ImageCropUpload.tsx:@crate/ui/shadcn/button:Button",
    2,
  ],
  [
    "app/ui/src/components/album/AlbumCard.tsx:@crate/ui/domain/entity/EntityCard:EntityCard",
    1,
  ],
  [
    "app/ui/src/components/album/AlbumCard.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  ["app/ui/src/components/album/AlbumGrid.tsx:./AlbumCard:AlbumCard", 1],
  [
    "app/ui/src/components/album/AlbumHeader.tsx:@/components/ImageCropUpload:ImageCropUpload",
    1,
  ],
  [
    "app/ui/src/components/album/AlbumHeader.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    5,
  ],
  [
    "app/ui/src/components/album/AlbumHeader.tsx:@crate/ui/primitives/ActionGroup:ActionLink",
    1,
  ],
  [
    "app/ui/src/components/album/AlbumHeader.tsx:@/components/genres/GenrePill:GenrePillRow",
    1,
  ],
  [
    "app/ui/src/components/album/AlbumRow.tsx:@crate/ui/domain/entity/EntityRow:EntityRow",
    1,
  ],
  [
    "app/ui/src/components/album/MissingAlbumCard.tsx:@crate/ui/domain/entity/EntityCard:EntityCard",
    1,
  ],
  [
    "app/ui/src/components/album/RelatedAlbums.tsx:@crate/ui/domain/entity/EntityCard:EntityCard",
    1,
  ],
  [
    "app/ui/src/components/album/TagEditor.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/album/TagEditor.tsx:@crate/ui/domain/genres/GenrePill:GenrePill",
    2,
  ],
  [
    "app/ui/src/components/album/TidalAlbumCard.tsx:@crate/ui/domain/entity/EntityCard:EntityCard",
    1,
  ],
  [
    "app/ui/src/components/album/TidalAlbumCard.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/album/TrackTable.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    2,
  ],
  [
    "app/ui/src/components/album/TrackTable.tsx:@crate/ui/shadcn/dialog:DialogContent",
    1,
  ],
  [
    "app/ui/src/components/album/TrackTable.tsx:@crate/ui/primitives/AppModal:AppModal",
    1,
  ],
  [
    "app/ui/src/components/album/TrackTable.tsx:@crate/ui/shadcn/dialog:DialogFooter",
    1,
  ],
  [
    "app/ui/src/components/album/TrackTable.tsx:@crate/ui/primitives/ActionGroup:ActionLink",
    1,
  ],
  [
    "app/ui/src/components/album/TrackTable.tsx:@/components/track/SimilarTracksPanel:SimilarTracksPanel",
    1,
  ],
  [
    "app/ui/src/components/album/TrackTable.tsx:@crate/ui/composites/ConfirmDialog:ConfirmDialog",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistArtworkGallery.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    4,
  ],
  [
    "app/ui/src/components/artist/ArtistArtworkGallery.tsx:@crate/ui/composites/ConfirmDialog:ConfirmDialog",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistArtworkSection.tsx:@crate/ui/shadcn/button:Button",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistArtworkSection.tsx:./ArtistArtworkGallery:ArtistArtworkGallery",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistArtworkSection.tsx:./ArtistHeroArtworkEditor:ArtistHeroArtworkEditor",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistArtworkSection.tsx:@/components/ImageCropUpload:ImageCropUpload",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistBioResearchAction.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistBioResearchDialog.tsx:@crate/ui/domain/ArtistBioProfile:ArtistBioProfile",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistBioResearchDialog.tsx:@crate/ui/shadcn/dialog:DialogContent",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistBioResearchDialog.tsx:@crate/ui/shadcn/dialog:DialogFooter",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistCard.tsx:@crate/ui/domain/entity:EntityCard",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistDiscographySection.tsx:@crate/ui/shadcn/button:Button",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistDiscographySection.tsx:@/components/ui:AdminSelect",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistDiscographySection.tsx:@/components/album/AlbumCard:AlbumCard",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistDiscographySection.tsx:@/components/album/TidalAlbumCard:TidalAlbumCard",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistDiscographySection.tsx:@/components/album/MissingAlbumCard:MissingAlbumCard",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistGenreSelector.tsx:@crate/ui/domain/genres/GenrePill:GenrePill",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistGenreSelector.tsx:@crate/ui/primitives/Checkbox:Checkbox",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx:./HeroCompositionCanvas:HeroCompositionCanvas",
    2,
  ],
  [
    "app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx:@crate/ui/primitives/AppModal:AppModal",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx:@crate/ui/primitives/AppModal:ModalCloseButton",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx:@crate/ui/composites/ConfirmDialog:ConfirmDialog",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx:@crate/ui/domain/genres/GenrePill:GenrePill",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistHeroSection.tsx:@/components/ImageCropUpload:ImageCropUpload",
    3,
  ],
  [
    "app/ui/src/components/artist/ArtistHeroSection.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    11,
  ],
  [
    "app/ui/src/components/artist/ArtistHeroSection.tsx:@/components/genres/GenrePill:GenrePillRow",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistMetadataEditor.tsx:@crate/ui/shadcn/dialog:DialogContent",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistMetadataEditor.tsx:./ArtistBioResearchAction:ArtistBioResearchAction",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistMetadataEditor.tsx:./ArtistGenreSelector:ArtistGenreSelector",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistMetadataEditor.tsx:@/components/ui/AdminSelect:AdminSelect",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistMetadataEditor.tsx:@crate/ui/shadcn/dialog:DialogFooter",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistMetadataEditor.tsx:@crate/ui/shadcn/button:Button",
    2,
  ],
  [
    "app/ui/src/components/artist/ArtistMetadataEditor.tsx:@crate/ui/composites/ConfirmDialog:ConfirmDialog",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistMetadataEditor.tsx:./ArtistBioResearchDialog:ArtistBioResearchDialog",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistOverviewSection.tsx:./ArtistBioResearchAction:ArtistBioResearchAction",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistOverviewSection.tsx:./ArtistTopTracksSection:ArtistTopTracksSection",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistPageBits.tsx:@crate/ui/domain/entity:EntityCard",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistRepairDialog.tsx:@crate/ui/shadcn/dialog:DialogContent",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistRepairDialog.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistRepairDialog.tsx:@crate/ui/primitives/Checkbox:Checkbox",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistRepairDialog.tsx:@crate/ui/shadcn/dialog:DialogFooter",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistRow.tsx:@crate/ui/domain/entity:EntityRow",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistRow.tsx:@crate/ui/domain/genres/GenrePill:GenrePillRow",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistSetlistSection.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistShowsSection.tsx:@crate/ui/domain/states:ErrorState",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistShowsSection.tsx:@/components/shows/ShowManagementRow:ShowManagementRow",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistSimilarSection.tsx:@/components/artist/ArtistPageBits:SimilarArtistCard",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistStats.tsx:@crate/ui/primitives/ErrorState:ErrorState",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistStats.tsx:@crate/ui/composites/AdminSelect:AdminSelect",
    1,
  ],
  [
    "app/ui/src/components/system-health/MetricChart.tsx:@/components/charts/InstrumentChart:InstrumentChartLegend",
    1,
  ],
  [
    "app/ui/src/components/system-health/MetricChart.tsx:@crate/ui/shadcn/select:SelectTrigger",
    1,
  ],
  [
    "app/ui/src/components/system-health/MetricChart.tsx:@crate/ui/shadcn/select:SelectContent",
    1,
  ],
  [
    "app/ui/src/pages/SystemHealth.tsx:@/components/system-health/MetricChart:MetricChart",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistStatsSection.tsx:@/components/artist/ArtistStats:ArtistStats",
    1,
  ],
  [
    "app/ui/src/components/artist/ArtistTopTracksSection.tsx:@crate/ui/domain/entity:EntityRow",
    2,
  ],
  [
    "app/ui/src/components/artist/HeroCompositionCanvas.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    1,
  ],
  [
    "app/ui/src/components/scanner/MatchCard.tsx:@crate/ui/domain/entity/EntityRow:EntityRow",
    1,
  ],
  ["app/ui/src/pages/Album.tsx:@crate/ui/shadcn/dialog:DialogContent", 3],
  ["app/ui/src/pages/Album.tsx:@crate/ui/shadcn/dialog:DialogFooter", 3],
  ["app/ui/src/pages/Album.tsx:@crate/ui/primitives/ErrorState:ErrorState", 4],
  ["app/ui/src/pages/Album.tsx:@/components/album/AlbumHeader:AlbumHeader", 1],
  [
    "app/ui/src/pages/Album.tsx:@crate/ui/primitives/ActionGroup:ActionButton",
    7,
  ],
  ["app/ui/src/pages/Album.tsx:@/components/album/TagEditor:TagEditor", 1],
  ["app/ui/src/pages/Album.tsx:@/components/scanner/MatchCard:MatchCard", 1],
  ["app/ui/src/pages/Album.tsx:@/components/album/TrackTable:TrackTable", 1],
  [
    "app/ui/src/pages/Album.tsx:@/components/album/RelatedAlbums:RelatedAlbums",
    1,
  ],
  [
    "app/ui/src/pages/Album.tsx:@crate/ui/composites/ConfirmDialog:ConfirmDialog",
    2,
  ],
  ["app/ui/src/pages/Artist.tsx:@crate/ui/shadcn/dialog:DialogContent", 1],
  ["app/ui/src/pages/Artist.tsx:@crate/ui/shadcn/dialog:DialogFooter", 1],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistOverviewSection:ArtistOverviewSection",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistTopTracksSection:ArtistTopTracksSection",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistDiscographySection:ArtistDiscographySection",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistSetlistSection:ArtistSetlistSection",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistShowsSection:ArtistShowsSection",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistSimilarSection:ArtistSimilarSection",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistStatsSection:ArtistStatsSection",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistArtworkSection:ArtistArtworkSection",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@crate/ui/composites/ConfirmDialog:ConfirmDialog",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistRepairDialog:ArtistRepairDialog",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistMetadataEditor:ArtistMetadataEditor",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistBioResearchDialog:ArtistBioResearchDialog",
    1,
  ],
  [
    "app/ui/src/pages/Artist.tsx:@/components/artist/ArtistHeroSection:ArtistHeroSection",
    1,
  ],
  ["app/ui/src/pages/Artist.tsx:@crate/ui/primitives/ErrorState:ErrorState", 4],
]);
// Diego's 1W steering explicitly retains UX glyphs. Each concrete site remains bounded.
const approvedUx = new Map([
  ["ListPagination:pagination-previous", ["lucide-react", "ChevronLeft"]],
  ["ListPagination:pagination-next", ["lucide-react", "ChevronRight"]],

  ["Shell:mobile-search", ["@crate/ui/icons", "Search"]],
  ["Playlists:playlists-mobile-actions", ["lucide-react", "MoreHorizontal"]],
  ["NewReleases:releases-timeline-download", ["@crate/ui/icons", "Download"]],

  ["SmartMixActivity:mix-activity-loading", ["@crate/ui/icons", "Loader2"]],
  ["SmartMixCoverage:mix-start-loading", ["@crate/ui/icons", "Loader2"]],
  ["SmartMixCoverage:mix-resume-loading", ["@crate/ui/icons", "Loader2"]],
  ["SmartMixCoverage:mix-pause-loading", ["@crate/ui/icons", "Loader2"]],
  ["SmartMixCoverage:mix-cancel-loading", ["@crate/ui/icons", "Loader2"]],
  ["SmartMixTracks:mix-reanalyze-loading", ["@crate/ui/icons", "Loader2"]],
  ["SmartMixTracks:mix-load-more-loading", ["@crate/ui/icons", "Loader2"]],
  ["SystemHealth:system-health-loading", ["lucide-react", "Loader2"]],
  ["Discover:discover-block-loading", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-refresh-setlists-loading", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-refresh-setlists", ["lucide-react", "CalendarSync"]],
  ["Upcoming:upcoming-dismiss-notice", ["lucide-react", "X"]],
  ["ShowManagementRow:upcoming-close-details", ["lucide-react", "X"]],
  [
    "ShowManagementRow:upcoming-detail-open-artist",
    ["@crate/ui/icons", "UserRound"],
  ],
  [
    "ShowManagementRow:upcoming-row-open-artist",
    ["@crate/ui/icons", "UserRound"],
  ],
  [
    "ShowManagementRow:upcoming-detail-open-listing",
    ["@crate/ui/icons", "ExternalLink"],
  ],
  [
    "ShowManagementRow:upcoming-row-open-listing",
    ["@crate/ui/icons", "ExternalLink"],
  ],

  // Functional Artist/Album actions and the search/disclosure/loading sites they use.
  // HeroArtworkEditor's two Play/Heart sites render the non-interactive Listen hero
  // preview inside its composition instrument; they are not Admin content decoration.
  // HeroCompositionCanvas's static IconToolButton wrapper is misclassified as dynamic
  // by the inventory name heuristic. Only its six individually named calls are accepted;
  // the wrapper's actual ActionButton and each child glyph are still audited below.
  ["Insights:insights-refresh", ["@crate/ui/icons", "RefreshCw"]],
  ["Artist:artist-merge-search-loading", ["@crate/ui/icons", "Loader2"]],
  ["Album:album-move-search-loading", ["@crate/ui/icons", "Loader2"]],
  ["Album:album-merge-search-loading", ["@crate/ui/icons", "Loader2"]],
  ["Album:album-split-loading", ["@crate/ui/icons", "Loader2"]],
  ["Album:album-edit-tags", ["@crate/ui/icons", "Tag"]],
  ["Album:album-move", ["@crate/ui/icons", "ArrowRight"]],
  ["Album:album-merge", ["@crate/ui/icons", "Link"]],
  ["Album:album-split", ["@crate/ui/icons", "Copy"]],
  ["Album:album-sync-musicbrainz", ["@crate/ui/icons", "RefreshCw"]],
  ["Album:album-analyze", ["@crate/ui/icons", "BarChart3"]],
  ["Album:album-delete", ["@crate/ui/icons", "Trash2"]],
  ["HeroCompositionCanvas:composition-zoom-out", ["local", "IconToolButton"]],
  [
    "HeroCompositionCanvas:composition-zoom-out-glyph",
    ["lucide-react", "ZoomOut"],
  ],
  ["HeroCompositionCanvas:composition-zoom-in", ["local", "IconToolButton"]],
  [
    "HeroCompositionCanvas:composition-zoom-in-glyph",
    ["lucide-react", "ZoomIn"],
  ],
  ["HeroCompositionCanvas:composition-flip", ["local", "IconToolButton"]],
  [
    "HeroCompositionCanvas:composition-flip-glyph",
    ["lucide-react", "FlipHorizontal2"],
  ],
  [
    "HeroCompositionCanvas:composition-rotate-left",
    ["local", "IconToolButton"],
  ],
  [
    "HeroCompositionCanvas:composition-rotate-left-glyph",
    ["lucide-react", "RotateCcw"],
  ],
  [
    "HeroCompositionCanvas:composition-rotate-right",
    ["local", "IconToolButton"],
  ],
  [
    "HeroCompositionCanvas:composition-rotate-right-glyph",
    ["lucide-react", "RotateCw"],
  ],
  ["HeroCompositionCanvas:composition-reset", ["local", "IconToolButton"]],
  [
    "HeroCompositionCanvas:composition-reset-glyph",
    ["lucide-react", "RefreshCcw"],
  ],
  [
    "ArtistSetlistSection:artist-refresh-setlist",
    ["@crate/ui/icons", "RefreshCw"],
  ],
  ["ArtistRepairDialog:repair-refresh", ["@crate/ui/icons", "RefreshCw"]],
  ["ArtistRepairDialog:repair-plan-loading", ["@crate/ui/icons", "Loader2"]],
  ["ArtistRepairDialog:repair-issues-loading", ["@crate/ui/icons", "Loader2"]],
  ["ArtistRepairDialog:repair-scope-loading", ["@crate/ui/icons", "Loader2"]],
  ["ArtistRepairDialog:repair-preview-loading", ["@crate/ui/icons", "Loader2"]],
  ["ArtistRepairDialog:repair-queue-loading", ["@crate/ui/icons", "Loader2"]],
  ["ArtistHeroSection:artist-enrich", ["@crate/ui/icons", "RefreshCw"]],
  ["ArtistHeroSection:artist-analyze", ["@crate/ui/icons", "AudioLines"]],
  ["ArtistHeroSection:artist-edit", ["@crate/ui/icons", "Pencil"]],
  ["ArtistHeroSection:artist-core-playlist", ["@crate/ui/icons", "ListMusic"]],
  ["ArtistHeroSection:artist-sync-lyrics", ["@crate/ui/icons", "AlignLeft"]],
  ["ArtistHeroSection:artist-write-metadata", ["@crate/ui/icons", "Tag"]],
  ["ArtistHeroSection:artist-export-metadata", ["@crate/ui/icons", "Archive"]],
  ["ArtistHeroSection:artist-repair", ["@crate/ui/icons", "Toolbox"]],
  ["ArtistHeroSection:artist-diagnose", ["@crate/ui/icons", "Shield"]],
  ["ArtistHeroSection:artist-merge", ["@crate/ui/icons", "Link"]],
  ["ArtistHeroSection:artist-delete", ["@crate/ui/icons", "Trash2"]],
  [
    "ArtistHeroArtworkEditor:hero-save-desktop-loading",
    ["@crate/ui/icons", "Loader2"],
  ],
  [
    "ArtistHeroArtworkEditor:hero-save-mobile-loading",
    ["@crate/ui/icons", "Loader2"],
  ],
  [
    "ArtistHeroArtworkEditor:hero-preview-loading",
    ["@crate/ui/icons", "Loader2"],
  ],
  ["ArtistHeroArtworkEditor:hero-preview-play", ["@crate/ui/icons", "Play"]],
  ["ArtistHeroArtworkEditor:hero-preview-follow", ["@crate/ui/icons", "Heart"]],
  [
    "ArtistGenreSelector:artist-genres-disclosure",
    ["@crate/ui/icons", "ChevronDown"],
  ],
  [
    "ArtistBioResearchDialog:bio-research-loading",
    ["@crate/ui/icons", "Loader2"],
  ],
  ["ArtistBioResearchDialog:bio-apply-loading", ["@crate/ui/icons", "Loader2"]],
  ["ArtistBioResearchAction:artist-research-bio", ["@crate/ui/icons", "Bot"]],
  ["ArtistArtworkGallery:artwork-upload", ["@crate/ui/icons", "ImagePlus"]],
  ["ArtistArtworkGallery:artwork-search", ["@crate/ui/icons", "Search"]],
  ["ArtistArtworkGallery:artwork-loading", ["@crate/ui/icons", "Loader2"]],
  ["ArtistArtworkGallery:artwork-delete", ["@crate/ui/icons", "Trash2"]],
  [
    "ArtistArtworkGallery:artwork-upload-loading",
    ["@crate/ui/icons", "Loader2"],
  ],
  ["ArtistArtworkGallery:artwork-ai-generate", ["@crate/ui/icons", "Bot"]],
  ["ArtistArtworkGallery:artwork-ai-loading", ["@crate/ui/icons", "Loader2"]],
  ["TrackTable:track-sync-lyrics", ["@crate/ui/icons", "AlignLeft"]],
  ["TrackTable:track-move-search-loading", ["@crate/ui/icons", "Loader2"]],
  ["TrackTable:track-audio-profile", ["@crate/ui/icons", "BarChart3"]],
  ["TrackTable:track-download", ["@crate/ui/icons", "Download"]],
  ["TidalAlbumCard:album-acquire-tidal", ["@crate/ui/icons", "Download"]],
  ["TagEditor:album-save-tags", ["@crate/ui/icons", "Save"]],
  ["AlbumHeader:album-enrich", ["@crate/ui/icons", "Bot"]],
  ["AlbumHeader:album-download", ["@crate/ui/icons", "Download"]],
  ["AlbumHeader:album-sync-lyrics", ["@crate/ui/icons", "AlignLeft"]],
  ["AlbumHeader:album-write-metadata", ["@crate/ui/icons", "Save"]],
  ["AlbumHeader:album-export-metadata", ["@crate/ui/icons", "Share2"]],
  ["AlbumHeader:album-diagnose", ["@crate/ui/icons", "Shield"]],
  ["AlbumCard:album-cover-loading", ["@crate/ui/icons", "Loader2"]],
  ["AlbumCard:album-cover-search", ["@crate/ui/icons", "ImagePlus"]],
  ["ImageCropUpload:crop-upload", ["@crate/ui/icons", "Camera"]],
  ["Playlists:playlists-open-editor", ["lucide-react", "Pencil"]],
  ["Playlists:playlists-deactivate", ["lucide-react", "PowerOff"]],
  ["Playlists:playlists-activate", ["lucide-react", "Power"]],
  ["Playlists:playlists-delete", ["lucide-react", "Trash2"]],
  // Explicit all-header adoption requested by Diego; one bounded site per action.
  ["Dashboard:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Dashboard:header-maintenance", ["lucide-react", "Wrench"]],
  ["Analysis:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Analysis:header-backfill-fingerprints", ["lucide-react", "Fingerprint"]],
  ["Analysis:header-recompute-popularity", ["lucide-react", "TrendingUp"]],
  ["Analysis:header-recompute-bliss", ["lucide-react", "Orbit"]],
  ["Analysis:header-re-analyze-all", ["lucide-react", "AudioLines"]],
  ["SystemHealth:header-refresh-metrics", ["lucide-react", "RefreshCw"]],
  ["Trash:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Trash:header-empty-trash", ["lucide-react", "Trash2"]],
  ["Contributions:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Discover:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Discover:header-recompute-gaps", ["lucide-react", "ChartNoAxesCombined"]],
  ["Discover:header-check-releases", ["lucide-react", "Radar"]],
  ["GlobalCatalog:header-refresh", ["lucide-react", "RefreshCw"]],
  ["GlobalCatalog:header-reconcile", ["lucide-react", "GitMerge"]],
  ["GlobalCatalog:header-full-rebuild", ["lucide-react", "DatabaseBackup"]],
  ["I18nReview:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Logs:header-refresh", ["lucide-react", "RefreshCw"]],
  ["Stack:header-refresh", ["@crate/ui/icons", "RefreshCw"]],
  ["Stack:service-logs", ["@crate/ui/icons", "ListOrdered"]],
  ["Stack:service-stop", ["@crate/ui/icons", "Square"]],
  ["Stack:service-start", ["@crate/ui/icons", "Play"]],
  ["Stack:service-restart", ["@crate/ui/icons", "RotateCcw"]],
  ["Stack:service-external", ["@crate/ui/icons", "ExternalLink"]],
  ["Health:header-run-scan", ["lucide-react", "ScanSearch"]],
  ["Bandcamp:header-sync-collection", ["@crate/ui/icons", "RefreshCw"]],
  ["Bandcamp:header-refresh-radar", ["@crate/ui/icons", "Radar"]],
  ["Bandcamp:header-backfill-urls", ["@crate/ui/icons", "Link"]],
  ["NewReleases:header-timeline", ["lucide-react", "List"]],
  ["NewReleases:header-grid", ["lucide-react", "LayoutGrid"]],
  ["NewReleases:header-check-now", ["lucide-react", "Radar"]],
  ["Users:header-invite-user", ["lucide-react", "MailPlus"]],
  ["Users:header-add-user", ["lucide-react", "UserPlus"]],
  ["Upcoming:header-sync-shows", ["lucide-react", "CalendarSync"]],
  ["Upcoming:header-clear-caches", ["lucide-react", "Eraser"]],
  ["AddShowButton:show-add", ["@crate/ui/icons", "CalendarPlus"]],
  ["MergeShowsButton:show-merge", ["@crate/ui/icons", "Link"]],
  ["Imports:header-refresh-queue", ["@crate/ui/icons", "RefreshCw"]],
  ["Imports:imports-import-all", ["@crate/ui/icons", "ArrowDownToLine"]],
  ["Playlists:header-new-static", ["lucide-react", "FilePlus2"]],
  ["Playlists:header-new-smart", ["lucide-react", "ListPlus"]],
  // Reviewed editor actions use Solar; row controls are audited in their own file.
  ["PlaylistEditor:editor-duplicate-action", ["@crate/ui/icons", "Copy"]],
  ["PlaylistEditor:editor-preview-action", ["@crate/ui/icons", "Eye"]],
  ["PlaylistEditor:editor-generate-action", ["@crate/ui/icons", "RefreshCw"]],
  ["PlaylistEditor:editor-save-action", ["@crate/ui/icons", "Save"]],
  ["PlaylistEditor:editor-remove-rule", ["@crate/ui/icons", "Trash2"]],
  ["PlaylistEditor:editor-edit-cover", ["@crate/ui/icons", "Camera"]],
  ["PlaylistEditor:editor-remove-cover", ["@crate/ui/icons", "Trash2"]],
  ["PlaylistEditor:editor-preview", ["@crate/ui/icons", "Loader2"]],
  ["PlaylistEditor:editor-generate", ["@crate/ui/icons", "Loader2"]],
  ["PlaylistEditor:editor-save", ["@crate/ui/icons", "Loader2"]],
  [
    "PlaylistEditorTrackList:playlist-track-move-up",
    ["@crate/ui/icons", "ArrowUp"],
  ],
  [
    "PlaylistEditorTrackList:playlist-track-move-down",
    ["@crate/ui/icons", "ArrowDown"],
  ],
  [
    "PlaylistEditorTrackList:playlist-track-remove",
    ["@crate/ui/icons", "Trash2"],
  ],
  ["Playlists:playlists-remove-rule", ["lucide-react", "Trash2"]],
  ["Playlists:playlists-loading", ["lucide-react", "Loader2"]],
  ["Playlists:playlists-static-close", ["lucide-react", "X"]],
  ["Playlists:playlists-static-saving", ["lucide-react", "Loader2"]],
  ["Playlists:playlists-smart-close", ["lucide-react", "X"]],
  ["Playlists:playlists-smart-saving", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-view-list", ["@crate/ui/icons", "ListOrdered"]],
  ["Upcoming:upcoming-view-calendar", ["@crate/ui/icons", "Calendar"]],
  ["Upcoming:upcoming-sync", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-loading", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-download-loading", ["lucide-react", "Loader2"]],
  ["Upcoming:upcoming-dismiss", ["@crate/ui/icons", "X"]],
  ["Upcoming:upcoming-open-album", ["@crate/ui/icons", "ExternalLink"]],
  ["Upcoming:upcoming-download", ["@crate/ui/icons", "Download"]],
  ["Upcoming:upcoming-previous", ["lucide-react", "ChevronLeft"]],
  ["Upcoming:upcoming-next", ["lucide-react", "ChevronRight"]],
  ["Upcoming:upcoming-popover-loading", ["lucide-react", "Loader2"]],
  ["ShowCard:show-tickets-external", ["@crate/ui/icons", "ExternalLink"]],
  ["ShowCard:show-close", ["@crate/ui/icons", "X"]],
  ["ShowCard:show-preview-open-artist", ["@crate/ui/icons", "UserRound"]],
  ["ShowCard:show-preview-tickets", ["@crate/ui/icons", "ExternalLink"]],
  ["Browse:browse-batch-enrich", ["@crate/ui/icons", "RefreshCw"]],
  ["Browse:browse-batch-analyze", ["@crate/ui/icons", "AudioLines"]],
  ["Browse:browse-batch-delete", ["@crate/ui/icons", "Trash2"]],
  ["Browse:browse-batch-select-all", ["@crate/ui/icons", "Check"]],
  ["Browse:browse-batch-cancel", ["@crate/ui/icons", "X"]],

  ["I18nReview:translations-refresh", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-draft", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-export", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-reject", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-publish", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-save", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-workspace-save", ["lucide-react", "Loader2"]],
  ["I18nReview:translations-loading", ["lucide-react", "Loader2"]],
  ["Users:users-list-loading", ["lucide-react", "Loader2"]],
  ["Users:users-detail-loading", ["lucide-react", "Loader2"]],
  ["Users:users-roles-loading", ["lucide-react", "Loader2"]],
  ["Users:users-status-loading", ["lucide-react", "Loader2"]],
  ["Users:users-revoke-all-loading", ["lucide-react", "Loader2"]],
  ["Users:users-revoke-loading", ["lucide-react", "Loader2"]],
  ["Users:users-password-loading", ["lucide-react", "Loader2"]],
  ["Users:users-create-loading", ["lucide-react", "Loader2"]],
  ["Users:users-invite-loading", ["lucide-react", "Loader2"]],
  ["Users:users-search", ["lucide-react", "Search"]],
  ["Users:users-previous", ["lucide-react", "ChevronLeft"]],
  ["Users:users-next", ["lucide-react", "ChevronRight"]],
  ["GlobalCatalog:catalog-incremental-loading", ["lucide-react", "Loader2"]],
  ["GlobalCatalog:catalog-full-loading", ["lucide-react", "Loader2"]],
  ["NewReleases:releases-loading", ["lucide-react", "Loader2"]],
  ["NewReleases:releases-check-loading", ["lucide-react", "Loader2"]],
  ["NewReleases:releases-download-loading", ["lucide-react", "Loader2"]],
  ["NewReleases:releases-timeline-dismiss", ["lucide-react", "X"]],
  ["NewReleases:releases-grid-dismiss", ["lucide-react", "X"]],
  ["Discover:discovery-loading", ["lucide-react", "Loader2"]],
  ["Discover:discovery-recompute-loading", ["lucide-react", "Loader2"]],
  ["Discover:discovery-check-loading", ["lucide-react", "Loader2"]],
  ["Bandcamp:bandcamp-sync-loading", ["@crate/ui/icons", "Loader2"]],
  ["Bandcamp:bandcamp-backfill-loading", ["@crate/ui/icons", "Loader2"]],
  ["Bandcamp:bandcamp-confirm-loading", ["@crate/ui/icons", "Loader2"]],
  ["Bandcamp:bandcamp-match-external", ["lucide-react", "ExternalLink"]],
  ["Bandcamp:bandcamp-confirmed-external", ["lucide-react", "ArrowUpRight"]],
  ["Bandcamp:bandcamp-item-external", ["lucide-react", "ExternalLink"]],
  ["Contributions:contributions-refresh-loading", ["lucide-react", "Loader2"]],
  ["Contributions:contributions-list-loading", ["lucide-react", "Loader2"]],
  ["Trash:trash-refresh-loading", ["lucide-react", "Loader2"]],
  ["Trash:trash-empty-loading", ["lucide-react", "Loader2"]],
  ["Trash:trash-list-loading", ["lucide-react", "Loader2"]],
  ["Trash:trash-row-loading", ["lucide-react", "Loader2"]],
  ["Health:health-scan-loading", ["lucide-react", "Loader2"]],
  ["Health:health-loading", ["lucide-react", "Loader2"]],
  ["Health:health-fix-loading", ["lucide-react", "Loader2"]],
  ["Health:health-group-collapse", ["lucide-react", "ChevronUp"]],
  ["Health:health-group-expand", ["lucide-react", "ChevronDown"]],
  ["Dashboard:dashboard-running-task", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-loading", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-fingerprints", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-popularity", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-bliss", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-analysis", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-lyrics", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-portable", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-rehydrate", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-richExport", ["lucide-react", "Loader2"]],
  ["Logs:logs-loading", ["lucide-react", "Loader2"]],
  ["Logs:live-pause", ["lucide-react", "Pause"]],
  ["Logs:live-resume", ["lucide-react", "Play"]],
  ["Shell:history-back", ["lucide-react", "ChevronLeft"]],
  ["Shell:history-forward", ["lucide-react", "ChevronRight"]],
  ["Shell:mobile-navigation", ["lucide-react", "Menu"]],
  ["Shell:help-close", ["@crate/ui/shadcn/dialog", "DialogContent"]],
  ["Sidebar:sidebar-collapse", ["lucide-react", "PanelLeftClose"]],
  ["Sidebar:sidebar-expand", ["lucide-react", "PanelLeftOpen"]],
  [
    "Sidebar:drawer-close",
    ["@crate/ui/shadcn/overlay-close-button", "OverlayCloseButton"],
  ],
  ["CommandPalette:palette-search", ["lucide-react", "Search"]],
  ["SearchBar:search-field", ["lucide-react", "Search"]],
  ["SearchBar:search-loading", ["lucide-react", "Loader2"]],
  ["SearchBar:search-clear", ["lucide-react", "X"]],
  ["AIButton:ai-bot", ["@crate/ui/icons", "Bot"]],
  [
    "CommandPalette:palette-close",
    ["@crate/ui/shadcn/overlay-close-button", "OverlayCloseButton"],
  ],
]);
// Technical no-artwork fallbacks, distinct from decorative content glyphs.
// Each approval names one MediaCover callsite and its exact catalogue symbol/size.
const approvedFallbacks = new Map([
  ["NewReleases:releases-timeline-cover", "Disc3"],
  ["NewReleases:releases-card-cover", "Disc3"],
  ["ShowManagementRow:upcoming-show-cover", "Calendar"],
]);
// These two marked SVGs encode chart data. Their path, tag, semantics and
// one source site each are fixed; other inline SVGs still fail the inventory.
const approvedNativeInstruments = new Map<
  string,
  readonly (readonly [string, string])[]
>([
  [
    "app/ui/src/components/artist/ArtistStats.tsx:artist-release-timeline",
    [
      ["role", '"group"'],
      ["aria-label", '"Chronological releases"'],
      ["viewBox", "{`0 0 ${timelineWidth} ${height}`}"],
    ],
  ],
  [
    "app/ui/src/components/charts/InstrumentChart.tsx:chart-series-legend",
    [
      ["aria-hidden", '"true"'],
      ["width", "{22}"],
      ["height", "{10}"],
      ["viewBox", '"0 0 22 10"'],
    ],
  ],
]);
function violations(sources: Map<string, string>, entries: IconEntry[]) {
  const found: string[] = [];
  const controlUses = new Map<string, number>();
  const usedUx = new Set<string>();
  const trees = new Map<string, ts.SourceFile>();
  for (const entry of entries.filter((entry) => sources.has(entry.path))) {
    if (entry.kind === "external-visual") continue;
    const reviewedLocalComposition =
      entry.kind === "dynamic-glyph" &&
      entry.path === "app/ui/src/components/artist/HeroCompositionCanvas.tsx" &&
      entry.name === "IconToolButton" &&
      !entry.source;
    const possibleFallbackReference =
      entry.kind === "glyph-reference" &&
      entry.source === "@crate/ui/icons" &&
      ((entry.path === "app/ui/src/pages/NewReleases.tsx" &&
        (entry.origin ?? entry.name) === "Disc3") ||
        (entry.path === "app/ui/src/components/shows/ShowManagementRow.tsx" &&
          (entry.origin ?? entry.name) === "Calendar"));
    if (
      !reviewedLocalComposition &&
      !possibleFallbackReference &&
      ![
        "glyph-jsx",
        "owned-icon-consumer",
        "owned-vector-consumer",
        "native-visual",
        "icon-prop",
        "icon-property",
      ].includes(entry.kind)
    ) {
      found.push(entry.id);
      continue;
    }

    if (entry.source === "@crate/ui/domain/brand/CrateLogo") continue; // Existing identity asset.
    if (
      entry.path.endsWith("/Shell.tsx") &&
      ["./Sidebar", "./CommandPalette", "./SearchBar"].includes(
        entry.source ?? "",
      )
    )
      continue; // Checked directly in this scope.
    const key = `${entry.path}:${entry.source}`;
    const source = sources.get(entry.path)!;
    const tree =
      trees.get(entry.path) ??
      ts.createSourceFile(
        entry.path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    trees.set(entry.path, tree);
    let attributes: ts.JsxAttributes | undefined;
    let reviewedInstrument = false;
    function visit(node: ts.Node) {
      if (possibleFallbackReference && ts.isIdentifier(node)) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        const expression = node.parent;
        if (
          pos.line + 1 === entry.line &&
          pos.character + 1 === entry.column &&
          ts.isJsxExpression(expression) &&
          ts.isJsxAttribute(expression.parent) &&
          ts.isJsxAttributes(expression.parent.parent)
        )
          attributes = expression.parent.parent;
      }
      // Existing Leaflet marker assets are instrument data, not action glyph slots.
      if (
        entry.kind === "icon-property" &&
        entry.path === "app/ui/src/pages/Upcoming.tsx" &&
        ts.isPropertyAssignment(node)
      ) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        const call = ts.isObjectLiteralExpression(node.parent)
          ? node.parent.parent
          : undefined;
        const expected =
          entry.name === "iconUrl"
            ? "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png"
            : entry.name === "iconRetinaUrl"
              ? "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png"
              : undefined;
        if (
          pos.line + 1 === entry.line &&
          pos.character + 1 === entry.column &&
          call &&
          ts.isCallExpression(call) &&
          call.expression.getText(tree) === "L.Icon.Default.mergeOptions" &&
          ts.isStringLiteral(node.initializer) &&
          node.initializer.text === expected
        )
          reviewedInstrument = true;
      }
      if (entry.kind === "icon-prop" && ts.isJsxAttribute(node)) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        if (
          pos.line + 1 === entry.line &&
          pos.character + 1 === entry.column &&
          ts.isJsxAttributes(node.parent)
        )
          attributes = node.parent;
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        if (pos.line + 1 === entry.line && pos.character + 1 === entry.column)
          attributes = node.attributes;
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    const instrumentKey = `Upcoming:marker-${entry.name}`;
    if (reviewedInstrument && !usedUx.has(instrumentKey)) {
      usedUx.add(instrumentKey);
      continue;
    }
    if (!attributes) {
      found.push(entry.id);
      continue;
    }
    const attrs = attributes.properties;
    const prop = (name: string) =>
      attrs.find(
        (attr) => ts.isJsxAttribute(attr) && attr.name.getText(tree) === name,
      ) as ts.JsxAttribute | undefined;
    const unknownSpread = attrs.some(ts.isJsxSpreadAttribute);
    const instrumentMarker = prop("data-admin-instrument")?.initializer;
    if (entry.kind === "native-visual") {
      const parent = attributes.parent;
      const site =
        instrumentMarker && ts.isStringLiteral(instrumentMarker)
          ? `${entry.path}:${instrumentMarker.text}`
          : "";
      const required = approvedNativeInstruments.get(site);
      if (
        !unknownSpread &&
        entry.name === "svg" &&
        (ts.isJsxOpeningElement(parent) ||
          ts.isJsxSelfClosingElement(parent)) &&
        parent.tagName.getText(tree) === "svg" &&
        attrs.filter(
          (attr) =>
            ts.isJsxAttribute(attr) &&
            attr.name.getText(tree) === "data-admin-instrument",
        ).length === 1 &&
        required?.every(
          ([name, expected]) =>
            prop(name)?.initializer?.getText(tree) === expected,
        ) &&
        !usedUx.has(site)
      ) {
        usedUx.add(site);
        continue;
      }
      found.push(entry.id);
      continue;
    }
    const fallbackMarker = prop("data-admin-ux")?.initializer;
    if (fallbackMarker && ts.isStringLiteral(fallbackMarker)) {
      const marker = `${entry.path.split("/").pop()?.replace(".tsx", "")}:${
        fallbackMarker.text
      }`;
      const glyph = approvedFallbacks.get(marker);
      const parent = attributes.parent;
      const imports = new Map<string, { source: string; imported: string }>();
      for (const statement of tree.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.importClause?.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings)
        )
          for (const binding of statement.importClause.namedBindings.elements)
            imports.set(binding.name.text, {
              source: statement.moduleSpecifier.text,
              imported: binding.propertyName?.text ?? binding.name.text,
            });
      }
      const component =
        ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)
          ? imports.get(parent.tagName.getText(tree))
          : undefined;
      const fallback = prop("fallbackIcon")?.initializer?.getText(tree);
      const glyphBinding = glyph ? imports.get(glyph) : undefined;
      const sizeBinding = imports.get("CRATE_ICON_SIZE");
      const site = `${marker}:${entry.kind}:${entry.name}`;
      if (
        !unknownSpread &&
        glyph &&
        component?.source === "@crate/ui/domain/media/MediaCover" &&
        component.imported === "MediaCover" &&
        fallback === `{${glyph}}` &&
        glyphBinding?.source === "@crate/ui/icons" &&
        glyphBinding.imported === glyph &&
        sizeBinding?.source === "@crate/ui/icons" &&
        sizeBinding.imported === "CRATE_ICON_SIZE" &&
        prop("iconSize")?.initializer?.getText(tree) ===
          "{CRATE_ICON_SIZE.xl}" &&
        ((entry.kind === "icon-prop" &&
          ["fallbackIcon", "iconSize"].includes(entry.name)) ||
          (entry.kind === "glyph-reference" &&
            (entry.origin ?? entry.name) === glyph)) &&
        !usedUx.has(site)
      ) {
        usedUx.add(site);
        continue;
      }
    }
    // Inventory's /icon/i also matches aiConfigured. This reviewed local boolean prop
    // is not a glyph channel; accept only its original binding at this concrete site.
    if (
      entry.kind === "icon-prop" &&
      entry.path === "app/ui/src/pages/I18nReview.tsx" &&
      entry.component === "OverviewSection" &&
      entry.name === "aiConfigured" &&
      !unknownSpread &&
      prop("aiConfigured")?.initializer?.getText(tree) === "{aiConfigured}" &&
      !usedUx.has("I18nReview:boolean-aiConfigured")
    ) {
      usedUx.add("I18nReview:boolean-aiConfigured");
      continue;
    }

    // Only the Admin artwork wrapper may pin the decorative fallback off.
    // Require the original imported component and false after every spread.
    const artworkParent = attributes.parent;
    const artworkTag =
      ts.isJsxOpeningElement(artworkParent) ||
      ts.isJsxSelfClosingElement(artworkParent)
        ? artworkParent.tagName.getText(tree)
        : "";
    const artworkImport = tree.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text ===
          "@crate/ui/domain/playlists/PlaylistArtwork" &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (binding) =>
            binding.name.text === artworkTag &&
            binding.propertyName?.text === "PlaylistArtwork",
        ),
    );
    const fallback = prop("showFallbackIcon");
    const artworkKey = `PlaylistArtwork:disabled-fallback:${entry.kind}`;
    if (
      entry.path === "app/ui/src/components/playlists/PlaylistArtwork.tsx" &&
      artworkImport &&
      artworkTag === "PlaylistArtworkBase" &&
      ((entry.kind === "owned-icon-consumer" &&
        entry.source === "@crate/ui/domain/playlists/PlaylistArtwork") ||
        (entry.kind === "icon-prop" && entry.name === "showFallbackIcon")) &&
      fallback?.initializer?.getText(tree) === "{false}" &&
      attrs.filter(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(tree) === "showFallbackIcon",
      ).length === 1 &&
      attrs.indexOf(fallback) >
        attrs.reduce(
          (last, attr, index) => (ts.isJsxSpreadAttribute(attr) ? index : last),
          -1,
        ) &&
      !usedUx.has(artworkKey)
    ) {
      usedUx.add(artworkKey);
      continue;
    }

    const reviewedControl = approvedControls.get(key);
    if (
      !unknownSpread &&
      reviewedControl &&
      reviewedControl.component === (entry.origin ?? entry.name)
    ) {
      controlUses.set(key, (controlUses.get(key) ?? 0) + 1);
      continue;
    }
    // FormField injects only IDs/ARIA control attributes into this existing Type select.
    // Keep its one exact render-prop binding reviewable; a same-named spread outside
    // that shared FormField callback, another binding, or an extra spread still fails.
    const knownFormControlSpread = (() => {
      if (
        entry.path !==
          "app/ui/src/components/artist/ArtistMetadataEditor.tsx" ||
        entry.source !== "@/components/ui/AdminSelect" ||
        (entry.origin ?? entry.name) !== "AdminSelect"
      )
        return false;
      const spreads = attrs.filter(ts.isJsxSpreadAttribute);
      if (
        spreads.length !== 1 ||
        spreads[0]!.expression.getText(tree) !== "control"
      )
        return false;
      let parent: ts.Node | undefined = attributes.parent;
      while (parent && !ts.isArrowFunction(parent)) parent = parent.parent;
      if (
        !parent ||
        !ts.isArrowFunction(parent) ||
        parent.parameters.length !== 1 ||
        parent.parameters[0]!.name.getText(tree) !== "control" ||
        !ts.isParenthesizedExpression(parent.body) ||
        !ts.isJsxSelfClosingElement(parent.body.expression) ||
        parent.body.expression.attributes !== attributes ||
        !ts.isJsxExpression(parent.parent) ||
        !ts.isJsxElement(parent.parent.parent) ||
        parent.parent.parent.openingElement.tagName.getText(tree) !==
          "FormField"
      )
        return false;
      return tree.statements.some(
        (statement) =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "@crate/ui/primitives/FormField" &&
          statement.importClause?.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings) &&
          statement.importClause.namedBindings.elements.some(
            (binding) =>
              binding.name.text === "FormField" &&
              (binding.propertyName?.text ?? binding.name.text) === "FormField",
          ),
      );
    })();
    // AIButton delegates its busy glyph to the shared Button. Only accept the
    // component's own rest binding when its explicit loading prop follows it;
    // caller props must never override that reviewed glyph channel. The Bot
    // child is still checked separately, and the shared consumer count is one.
    const knownAIButtonLoadingSpread = (() => {
      if (
        entry.path !== "app/ui/src/components/ui/AIButton.tsx" ||
        entry.source !== "@crate/ui/shadcn/button" ||
        (entry.origin ?? entry.name) !== "Button"
      )
        return false;
      const spreads = attrs.filter(ts.isJsxSpreadAttribute);
      const loading = prop("loading");
      if (
        spreads.length !== 1 ||
        spreads[0]!.expression.getText(tree) !== "props" ||
        loading?.initializer?.getText(tree) !== "{loading}" ||
        attrs.indexOf(loading) < attrs.indexOf(spreads[0]!)
      )
        return false;
      let parent: ts.Node | undefined = attributes.parent;
      while (parent && !ts.isFunctionDeclaration(parent))
        parent = parent.parent;
      if (
        !parent ||
        !ts.isFunctionDeclaration(parent) ||
        parent.name?.text !== "AIButton" ||
        parent.parameters.length !== 1 ||
        !ts.isObjectBindingPattern(parent.parameters[0]!.name)
      )
        return false;
      const bindings = parent.parameters[0]!.name.elements;
      if (
        !bindings.some(
          (binding) =>
            binding.dotDotDotToken && binding.name.getText(tree) === "props",
        ) ||
        !bindings.some(
          (binding) =>
            !binding.dotDotDotToken &&
            binding.name.getText(tree) === "loading" &&
            (binding.propertyName?.getText(tree) ?? "loading") === "loading",
        )
      )
        return false;
      const element = attributes.parent;
      if (
        !ts.isJsxOpeningElement(element) &&
        !ts.isJsxSelfClosingElement(element)
      )
        return false;
      const localName = element.tagName.getText(tree);
      return tree.statements.some(
        (statement) =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "@crate/ui/shadcn/button" &&
          statement.importClause?.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings) &&
          statement.importClause.namedBindings.elements.some(
            (binding) =>
              binding.name.text === localName &&
              (binding.propertyName?.text ?? binding.name.text) === "Button",
          ),
      );
    })();
    const libraryControlKey = `${key}:${entry.origin ?? entry.name}`;
    const libraryControlLimit = approvedLibraryControls.get(libraryControlKey);
    if (
      (!unknownSpread ||
        knownFormControlSpread ||
        knownAIButtonLoadingSpread) &&
      entry.kind.startsWith("owned-") &&
      libraryControlLimit !== undefined
    ) {
      controlUses.set(
        libraryControlKey,
        (controlUses.get(libraryControlKey) ?? 0) + 1,
      );
      continue;
    }
    const marker = prop("data-admin-ux")?.initializer;
    if (marker && ts.isStringLiteral(marker)) {
      const key = `${entry.path.split("/").pop()?.replace(".tsx", "")}:${
        marker.text
      }`;
      const approved = approvedUx.get(key);
      if (
        !unknownSpread &&
        approved &&
        approved[0] === (entry.source ?? "local") &&
        approved[1] === (entry.origin ?? entry.name) &&
        !usedUx.has(key)
      ) {
        usedUx.add(key);
        continue;
      }
    }
    if (!entry.kind.startsWith("owned-")) {
      found.push(entry.id);
      continue;
    }
    if (
      !unknownSpread &&
      ((entry.source === "@crate/ui/primitives/CrateBadge" &&
        ["CrateChip", "CratePill"].includes(entry.origin ?? entry.name)) ||
        (entry.source === "@crate/ui/primitives/InfoBadge" &&
          (entry.origin ?? entry.name) === "InfoBadge") ||
        (entry.source === "@crate/ui/primitives/FilterChip" &&
          (entry.origin ?? entry.name) === "FilterChip")) &&
      !prop("icon")
    )
      continue; // Shared badges render no glyph without an explicit icon prop.
    if (
      entry.source === "@crate/ui/shadcn/button" &&
      ((!unknownSpread && !prop("loading")) ||
        (prop("loading")?.initializer?.getText(tree) === "{false}" &&
          attrs.indexOf(prop("loading")!) >
            attrs.reduce(
              (last, attr, index) =>
                ts.isJsxSpreadAttribute(attr) ? index : last,
              -1,
            )))
    )
      continue;
    if (
      !unknownSpread &&
      ["@crate/ui/shadcn/dialog", "@crate/ui/shadcn/sheet"].includes(
        entry.source ?? "",
      ) &&
      prop("showCloseButton")?.initializer?.getText(tree) === "{false}"
    )
      continue;
    found.push(entry.id);
  }
  for (const [key, count] of controlUses)
    if (
      count >
      (approvedLibraryControls.get(key) ?? approvedControls.get(key)!.limit)
    )
      found.push(`${key}: reviewed control grew`);
  return found;
}

describe("Admin icon retirement policy — migrated Admin surfaces", () => {
  it("does not misclassify the exact shared action wrapper, while still auditing its children", () => {
    const source =
      'import {ActionIconButton} from "@crate/ui/primitives/ActionIconButton"; import {Trash2} from "@crate/ui/icons"; const view=<ActionIconButton title="Delete"><Trash2/></ActionIconButton>;';
    const entries = analyzeSource("fixture.tsx", source).entries;
    expect(entries.some((entry) => entry.kind === "dynamic-glyph")).toBe(false);
    expect(
      entries.some(
        (entry) => entry.kind === "glyph-jsx" && entry.origin === "Trash2",
      ),
    ).toBe(true);
    expect(
      analyzeSource(
        "fixture.tsx",
        source.replace(
          "@crate/ui/primitives/ActionIconButton",
          "./LocalActionIconButton",
        ),
      ).entries.some((entry) => entry.kind === "dynamic-glyph"),
    ).toBe(true);
  });
  it("bounds technical MediaCover fallbacks to the exact component, symbol and callsite", () => {
    const path = "app/ui/src/pages/NewReleases.tsx";
    const source =
      'import {MediaCover} from "@crate/ui/domain/media/MediaCover"; import {Disc3, CRATE_ICON_SIZE} from "@crate/ui/icons"; const view=<MediaCover data-admin-ux="releases-card-cover" fallbackIcon={Disc3} iconSize={CRATE_ICON_SIZE.xl}/>;';
    const check = (value: string) =>
      violations(new Map([[path, value]]), analyzeSource(path, value).entries);
    expect(check(source)).toEqual([]);
    expect(check(source.replace(/Disc3/g, "Search")).length).toBeGreaterThan(0);
    expect(
      check(source.replace("@crate/ui/domain/media/MediaCover", "./LocalCover"))
        .length,
    ).toBeGreaterThan(0);
    expect(
      check(
        source.replace(
          "/>;",
          '/>; const duplicate=<MediaCover data-admin-ux="releases-card-cover" fallbackIcon={Disc3} iconSize={CRATE_ICON_SIZE.xl}/>;',
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
  it("rejects direct, passed, mapped, dynamic and wrapped glyphs in the migrated files", () => {
    const inventory = buildInventory(repo);
    const sources = new Map(
      scope.map((path) => [path, readFileSync(join(repo, path), "utf8")]),
    );
    expect(violations(sources, inventory.entries)).toEqual([]);
  }, 15_000);
  it("keeps the newly reviewed Artist and Album subtree free of unregistered glyph sites", () => {
    const sources = new Map(
      libraryScope.map((path) => [
        path,
        readFileSync(join(repo, path), "utf8"),
      ]),
    );
    expect(violations(sources, buildInventory(repo).entries)).toEqual([]);
  }, 15_000);
  it("keeps editor glyph approvals aligned with the current Solar action sites", () => {
    for (const component of ["PlaylistEditor", "PlaylistEditorTrackList"]) {
      const path =
        component === "PlaylistEditor"
          ? "app/ui/src/pages/PlaylistEditor.tsx"
          : "app/ui/src/components/playlists/PlaylistEditorTrackList.tsx";
      const glyphs = analyzeSource(
        path,
        readFileSync(join(repo, path), "utf8"),
      ).entries.filter((entry) => entry.kind === "glyph-jsx");
      expect(glyphs.every((entry) => entry.source === "@crate/ui/icons")).toBe(
        true,
      );
      const liveMarkers = glyphs.map(
        (entry) =>
          `${component}:${
            entry.snippet.match(/data-admin-ux="([^"]+)"/)?.[1] ??
            "unregistered"
          }`,
      );
      expect(new Set(liveMarkers).size).toBe(glyphs.length);
      expect(liveMarkers.sort()).toEqual(
        [...approvedUx.keys()]
          .filter((key) => key.startsWith(`${component}:`))
          .sort(),
      );
    }
  });
  it("does not extend an editor row action approval to another glyph or duplicate marker", () => {
    const path = "app/ui/src/components/playlists/PlaylistEditorTrackList.tsx";
    const source =
      'import {ArrowUp} from "@crate/ui/icons"; const view=<ArrowUp data-admin-ux="playlist-track-move-up"/>;';
    const check = (value: string) =>
      violations(new Map([[path, value]]), analyzeSource(path, value).entries);
    expect(check(source)).toEqual([]);
    expect(check(source.replace(/ArrowUp/g, "Copy"))).toHaveLength(1);
    expect(
      check(
        source.replace(
          "/>;",
          '/>; const duplicate=<ArrowUp data-admin-ux="playlist-track-move-up"/>;',
        ),
      ),
    ).toHaveLength(1);
  });
  it("bounds AIButton's shared busy glyph without accepting opaque loading overrides", () => {
    const path = "app/ui/src/components/ui/AIButton.tsx";
    const source =
      'import {Button} from "@crate/ui/shadcn/button"; export function AIButton({loading,...props}) {return <Button {...props} loading={loading}/>;}';
    const check = (value: string) => {
      const tree = ts.createSourceFile(
        path,
        value,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const entries: IconEntry[] = [];
      function visit(node: ts.Node) {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(tree) === "Button"
        ) {
          const position = tree.getLineAndCharacterOfPosition(
            node.getStart(tree),
          );
          entries.push({
            id: `Button:${position.line}:${position.character}`,
            path,
            line: position.line + 1,
            column: position.character + 1,
            kind: "owned-icon-consumer",
            name: "Button",
            source: "@crate/ui/shadcn/button",
            control: "Button",
            label: "",
            snippet: node.getText(tree),
          });
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
      return violations(new Map([[path, value]]), entries);
    };
    expect(check(source)).toEqual([]);
    for (const changed of [
      source.replace(
        "{...props} loading={loading}",
        "loading={loading} {...props}",
      ),
      source.replace("{...props}", "{...other}"),
      source.replace("{...props}", "{...props} {...other}"),
      source.replace("loading={loading}", "loading={other}"),
      source.replace("@crate/ui/shadcn/button", "./LocalButton"),
    ])
      expect(check(changed)).toHaveLength(1);
    expect(
      check(
        source.replace(
          "/>;",
          "/>;} export function Duplicate(){return <Button loading={true}/>;",
        ),
      ),
    ).toHaveLength(1);
    const retired =
      'import {Loader2} from "@crate/ui/icons"; const view=<Loader2 data-admin-ux="ai-loading"/>;';
    expect(
      violations(
        new Map([[path, retired]]),
        analyzeSource(path, retired).entries,
      ),
    ).toHaveLength(1);
  });
  it("gives each Artist hero action a distinct glyph without including artwork overlays", () => {
    const path = "app/ui/src/components/artist/ArtistHeroSection.tsx";
    const actionSites = new Set(
      [...approvedUx.keys()]
        .filter((key) => key.startsWith("ArtistHeroSection:"))
        .map((key) => key.slice("ArtistHeroSection:".length)),
    );
    const actionGlyphs = analyzeSource(
      path,
      readFileSync(join(repo, path), "utf8"),
    ).entries.filter(
      (entry) =>
        entry.kind === "glyph-jsx" &&
        entry.control === "ActionButton" &&
        actionSites.has(
          entry.snippet.match(/data-admin-ux="([^"]+)"/)?.[1] ?? "",
        ),
    );
    expect(actionGlyphs).toHaveLength(actionSites.size);
    const symbols = actionGlyphs.map((entry) => entry.origin ?? entry.name);
    expect(symbols.filter((symbol) => symbol === "ListMusic")).toHaveLength(1);
    expect(symbols.filter((symbol) => symbol === "AlignLeft")).toHaveLength(1);
    expect(new Set(symbols).size).toBe(actionGlyphs.length);
  });
  it("rejects reusing the Core Tracks glyph for the Artist Lyrics action", () => {
    const path = "app/ui/src/components/artist/ArtistHeroSection.tsx";
    const source =
      'import {ListMusic} from "@crate/ui/icons"; const view=<><ListMusic data-admin-ux="artist-core-playlist"/><ListMusic data-admin-ux="artist-sync-lyrics"/></>;';
    expect(
      violations(
        new Map([[path, source]]),
        analyzeSource(path, source).entries,
      ),
    ).toHaveLength(1);
  });
  it("does not let a reviewed FormField callback become an opaque Select prop channel", () => {
    const path = "app/ui/src/components/artist/ArtistMetadataEditor.tsx";
    for (const source of [
      "const view=<AdminSelect {...control}/>;",
      "const view=<FormField>{control => <AdminSelect {...control}/>}</FormField>;",
      'import {FormField} from "@crate/ui/primitives/FormField"; const view=<FormField>{control => (<AdminSelect {...other}/>)}</FormField>;',
      'import {FormField} from "@crate/ui/primitives/FormField"; const view=<FormField>{control => (<AdminSelect {...control} {...other}/>)}</FormField>;',
    ]) {
      const tree = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const positions: number[] = [];
      function visit(node: ts.Node) {
        if (
          ts.isJsxSelfClosingElement(node) &&
          node.tagName.getText(tree) === "AdminSelect"
        )
          positions.push(node.getStart(tree));
        ts.forEachChild(node, visit);
      }
      visit(tree);
      const entries = positions.map((position) => {
        const pos = tree.getLineAndCharacterOfPosition(position);
        return {
          id: "select",
          path,
          line: pos.line + 1,
          column: pos.character + 1,
          kind: "owned-icon-consumer",
          name: "AdminSelect",
          source: "@/components/ui/AdminSelect",
          control: "AdminSelect",
          label: "",
          snippet: "",
        } as IconEntry;
      });
      expect(violations(new Map([[path, source]]), entries)).toHaveLength(1);
    }
  });
  it("bounds each library catalogue export without exempting the whole module", () => {
    const path = "app/ui/src/components/album/AlbumCard.tsx";
    const source = "<><ActionButton/><ActionButton/><OtherControl/></>";
    const tree = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const entries: IconEntry[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node)) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        entries.push({
          id: node.tagName.getText(tree),
          path,
          line: pos.line + 1,
          column: pos.character + 1,
          kind: "owned-icon-consumer",
          name: node.tagName.getText(tree),
          source: "@crate/ui/primitives/ActionGroup",
          control: node.tagName.getText(tree),
          label: "",
          snippet: "",
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(violations(new Map([[path, source]]), entries)).toEqual([
      "OtherControl",
      `${path}:@crate/ui/primitives/ActionGroup:ActionButton: reviewed control grew`,
    ]);
  });
  it("still audits an inline vector added inside the approved composition wrapper", () => {
    const path = "app/ui/src/components/artist/HeroCompositionCanvas.tsx";
    const source =
      'function IconToolButton(){return <svg><path/></svg>;} const view=<IconToolButton data-admin-ux="composition-zoom-out" label="Zoom out"/>;';
    expect(
      violations(new Map([[path, source]]), analyzeSource(path, source).entries)
        .length,
    ).toBeGreaterThan(0);
  });
  it("bounds native instruments to their marker, source file and one SVG site", () => {
    const path = "app/ui/src/components/charts/InstrumentChart.tsx";
    const legend =
      '<svg data-admin-instrument="chart-series-legend" aria-hidden="true" width={22} height={10} viewBox="0 0 22 10"><line/></svg>';
    const cases = [
      [path, legend.replace("chart-series-legend", "unknown-instrument")],
      [path, `<>${legend}${legend}</>`],
      ["app/ui/src/components/artist/ArtistStats.tsx", legend],
    ] as const;
    for (const [file, source] of cases) {
      const entries = analyzeSource(file, source).entries;
      expect(
        entries.filter((entry) => entry.kind === "native-visual"),
      ).toHaveLength(source.includes("</svg><svg") ? 2 : 1);
      expect(violations(new Map([[file, source]]), entries)).toHaveLength(1);
    }
  });
  it("does not extend an Album glyph approval to another symbol or duplicate site", () => {
    const path = "app/ui/src/components/album/AlbumHeader.tsx";
    for (const source of [
      'import {Search} from "@crate/ui/icons"; const view=<Search data-admin-ux="album-enrich"/>;',
      'import {Bot} from "@crate/ui/icons"; const view=<><Bot data-admin-ux="album-enrich"/><Bot data-admin-ux="album-enrich"/></>;',
    ])
      expect(
        violations(
          new Map([[path, source]]),
          analyzeSource(path, source).entries,
        ),
      ).toHaveLength(1);
  });
  it("rejects unnamed or duplicated local composition controls instead of hiding dynamic entries", () => {
    const path = "app/ui/src/components/artist/HeroCompositionCanvas.tsx";
    for (const source of [
      'const view=<IconToolButton label="New action"/>;',
      'const view=<><IconToolButton data-admin-ux="composition-zoom-out" label="Zoom out"/><IconToolButton data-admin-ux="composition-zoom-out" label="Zoom out"/></>;',
      'const view=<OtherIconToolButton data-admin-ux="composition-zoom-out"/>;',
    ])
      expect(
        violations(
          new Map([[path, source]]),
          analyzeSource(path, source).entries,
        ).length,
      ).toBeGreaterThan(0);
  });
  it("treats the exact shared size token as data while still auditing Solar glyphs", () => {
    const result = analyzeSource(
      "fixture.tsx",
      'import { CRATE_ICON_SIZE as Sizes, Download } from "@crate/ui/icons"; const view=<Download size={Sizes.lg}/>;',
    );
    expect(
      result.entries.filter(
        (e) => e.kind === "glyph-reference" && e.name === "Sizes",
      ),
    ).toEqual([]);
    expect(
      result.entries.filter(
        (e) => e.kind === "glyph-jsx" && e.name === "Download",
      ),
    ).toHaveLength(1);
  });
  it("bounds the artwork opt-out to one exact imported wrapper with false after every spread", () => {
    const path = "app/ui/src/components/playlists/PlaylistArtwork.tsx";
    const prefix =
      'import {PlaylistArtwork as PlaylistArtworkBase} from "@crate/ui/domain/playlists/PlaylistArtwork";';
    for (const source of [
      prefix +
        "const view = <PlaylistArtworkBase {...props} showFallbackIcon={true}/>;",
      prefix +
        "const view = <PlaylistArtworkBase {...props} showFallbackIcon={enabled}/>;",
      prefix +
        "const view = <PlaylistArtworkBase showFallbackIcon={false} {...props}/>;",
      prefix +
        "const view = <OtherArtwork {...props} showFallbackIcon={false}/>;",
      prefix +
        "const view = <><PlaylistArtworkBase {...props} showFallbackIcon={false}/><PlaylistArtworkBase {...props} showFallbackIcon={false}/></>;",
      "const view = <PlaylistArtworkBase {...props} showFallbackIcon={false}/>;",
    ])
      expect(
        violations(
          new Map([[path, source]]),
          analyzeSource(path, source).entries,
        ).length,
      ).toBeGreaterThan(0);
  });
  it("bounds Leaflet marker asset properties to their original instrument call and literals", () => {
    const path = "app/ui/src/pages/Upcoming.tsx";
    for (const source of [
      'const view = {iconUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png"};',
      "L.Icon.Default.mergeOptions({iconUrl: OtherIcon});",
      'L.Icon.Default.mergeOptions({iconUrl:"https://elsewhere.invalid/icon.svg"});',
    ])
      expect(
        violations(
          new Map([[path, source]]),
          analyzeSource(path, source).entries,
        ).length,
      ).toBeGreaterThan(0);
  });
  it("does not turn the aiConfigured inventory false positive into an icon channel", () => {
    const path = "app/ui/src/pages/I18nReview.tsx";
    for (const source of [
      "const view = <OverviewSection aiConfigured={SomeIcon}/>;",
      "const view = <OtherSection aiConfigured={aiConfigured}/>;",
      "const view = <OverviewSection {...props} aiConfigured={aiConfigured}/>;",
      "const view = <><OverviewSection aiConfigured={aiConfigured}/><OverviewSection aiConfigured={aiConfigured}/></>;",
    ])
      expect(
        violations(
          new Map([[path, source]]),
          analyzeSource(path, source).entries,
        ).length,
      ).toBeGreaterThan(0);
  });
  it.each([
    'import { Search as Glyph } from "lucide-react"; const view = <Glyph/>;',
    "const view = <Chip icon={someValue}/>;",
    "const map = {icon: value}; const view = <map.icon/>;",
    "const view = <svg><path/></svg>;",
    "const view = <Icon {...props}/>;",
  ])("detects an unapproved entry point: %s", (source) => {
    const path = scope[0]!;
    expect(
      violations(new Map([[path, source]]), analyzeSource(path, source).entries)
        .length,
    ).toBeGreaterThan(0);
  });
  it("rejects a new wrapper that hides an inline vector", () => {
    const root = mkdtempSync(join(tmpdir(), "crate-admin-icon-policy-"));
    try {
      const path = scope[0]!,
        source =
          'import { HiddenMark } from "./HiddenMark"; export const Sidebar = () => <HiddenMark/>;';
      mkdirSync(join(root, "app/ui/src/components/layout"), {
        recursive: true,
      });
      writeFileSync(join(root, path), source);
      writeFileSync(
        join(root, "app/ui/src/components/layout/HiddenMark.tsx"),
        "export const HiddenMark = () => <button><svg><path/></svg></button>;",
      );
      expect(
        violations(new Map([[path, source]]), buildInventory(root).entries),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("does not let a shared loading prop or implicit overlay close bypass the guard", () => {
    const path = scope[2]!,
      source = "<><Button loading/><DialogContent/></>";
    const entries: IconEntry[] = [
      ...analyzeSource(path, source).entries,
      {
        id: "spinner",
        path,
        line: 1,
        column: 3,
        kind: "owned-icon-consumer",
        name: "Button",
        source: "@crate/ui/shadcn/button",
        control: "Button",
        label: "",
        snippet: "",
      },
      {
        id: "close",
        path,
        line: 1,
        column: 20,
        kind: "owned-icon-consumer",
        name: "DialogContent",
        source: "@crate/ui/shadcn/dialog",
        control: "DialogContent",
        label: "",
        snippet: "",
      },
    ];
    expect(violations(new Map([[path, source]]), entries)).toEqual([
      "spinner",
      "close",
    ]);
  });
  it("only accepts forwarded Button props when built-in loading is explicitly off after every spread", () => {
    const path = scope[4]!;
    for (const [source, count] of [
      ["<Button {...props} loading={false}/>", 0],
      ["<Button loading={false} {...props}/>", 1],
      ["<Button {...props} loading/>", 1],
    ] as const) {
      const entry: IconEntry = {
        id: "forwarded-button",
        path,
        line: 1,
        column: 1,
        kind: "owned-icon-consumer",
        name: "Button",
        source: "@crate/ui/shadcn/button",
        control: "Button",
        label: "",
        snippet: "",
      };
      expect(violations(new Map([[path, source]]), [entry])).toHaveLength(
        count,
      );
    }
  });
});

it("does not extend a UX approval to another glyph or a duplicate callsite", () => {
  const path = scope[2]!;
  for (const source of [
    'import { Trash2 } from "lucide-react"; const view = <Trash2 data-admin-ux="history-back"/>;',
    'import { ChevronLeft } from "lucide-react"; const view = <><ChevronLeft data-admin-ux="history-back"/><ChevronLeft data-admin-ux="history-back"/></>;',
  ])
    expect(
      violations(
        new Map([[path, source]]),
        analyzeSource(path, source).entries,
      ),
    ).toHaveLength(1);
});

function operationalIconViolations(path: string, source: string) {
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const surfaces = new Set(["OpsPageHero", "OpsPanel", "OpsStatTile"]);
  const bindings = new Set<string>();
  for (const node of tree.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      node.moduleSpecifier.text !== "@/components/admin/ops-surfaces"
    )
      continue;
    const imports = node.importClause?.namedBindings;
    if (imports && ts.isNamedImports(imports)) {
      for (const entry of imports.elements) {
        if (surfaces.has((entry.propertyName ?? entry.name).text))
          bindings.add(entry.name.text);
      }
    } else if (imports && ts.isNamespaceImport(imports)) {
      for (const surface of surfaces)
        bindings.add(`${imports.name.text}.${surface}`);
    }
  }
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      bindings.has(node.tagName.getText(tree))
    ) {
      for (const attr of node.attributes.properties) {
        if (
          ts.isJsxSpreadAttribute(attr) ||
          (ts.isJsxAttribute(attr) && attr.name.getText(tree) === "icon")
        )
          found.push(
            `${path}:${
              tree.getLineAndCharacterOfPosition(attr.getStart(tree)).line + 1
            }`,
          );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

function productionTsx(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? productionTsx(path)
      : entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [path]
        : [];
  });
}

describe("Admin operational surface consumer contracts", () => {
  it("does not pass decorative icons or opaque props to retired operational surfaces", () => {
    const found = productionTsx(join(repo, "app/ui/src")).flatMap((path) =>
      operationalIconViolations(path, readFileSync(path, "utf8")),
    );
    expect(found).toEqual([]);
  });
  it.each([
    [
      'import { OpsPanel } from "@/components/admin/ops-surfaces"; const view = <OpsPanel icon={Glyph}/>;',
      1,
    ],
    [
      'import { OpsPageHero as Hero } from "@/components/admin/ops-surfaces"; const view = <Hero icon={Glyph}/>;',
      1,
    ],
    [
      'import * as Ops from "@/components/admin/ops-surfaces"; const view = <Ops.OpsStatTile {...props}/>;',
      1,
    ],
    [
      'import { OpsPanel } from "@/components/admin/ops-surfaces"; const view = <OpsPanel title="Tasks" action={<button>Refresh</button>}>Jobs</OpsPanel>;',
      0,
    ],
  ] as const)(
    "checks aliases and spreads without banning action slots: %s",
    (source, count) => {
      expect(operationalIconViolations("fixture.tsx", source)).toHaveLength(
        count,
      );
    },
  );
});

it("does not let badge icon props or opaque spreads bypass the migrated page guard", () => {
  const path = "app/ui/src/pages/Logs.tsx";
  for (const [source, count] of [
    ["<CratePill>Live</CratePill>", 0],
    ["<CratePill icon={Glyph}>Live</CratePill>", 1],
    ["<CratePill {...props}>Live</CratePill>", 1],
  ] as const) {
    const entry: IconEntry = {
      id: "badge",
      path,
      line: 1,
      column: 1,
      kind: "owned-icon-consumer",
      name: "CratePill",
      source: "@crate/ui/primitives/CrateBadge",
      control: "CratePill",
      label: "",
      snippet: "",
    };
    expect(violations(new Map([[path, source]]), [entry])).toHaveLength(count);
  }
});
