import { useState } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { Button } from "@crate/ui/shadcn/button";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { SectionHeader, MediaGrid } from "@crate/ui/domain/lists";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { Avatar } from "@crate/ui/primitives/Avatar";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { SkipLink } from "@crate/ui/primitives/SkipLink";
import { DesktopShellView } from "../../../app/listen/src/components/layout/DesktopShellView";
import { MobileShellView } from "../../../app/listen/src/components/layout/MobileShellView";
import { SidebarView } from "../../../app/listen/src/components/layout/sidebar/SidebarView";
import { SidebarBrand } from "../../../app/listen/src/components/layout/sidebar/SidebarBrand";
import {
  SidebarNavigationView,
  MobileNavigationView,
} from "../../../app/listen/src/components/layout/ListenNavigation";
import {
  collectionNavigationItems,
  listenNavigationItems,
} from "../../../app/listen/src/components/layout/listen-navigation-model";
import {
  CollectionTabs,
  COLLECTION_SECTIONS,
} from "../../../app/listen/src/components/layout/CollectionTabs";
import { TopBarView } from "../../../app/listen/src/components/layout/TopBarView";
import { RouteContent } from "../../../app/listen/src/components/layout/RouteContent";
import { SearchFormView } from "../../../app/listen/src/pages/SearchFormView";
import { useTabParam } from "../../../app/listen/src/hooks/use-tab-param";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { LibraryLikedView } from "../../../app/listen/src/pages/LibraryLikedView";
import { CollectionSortDropdown } from "../../../app/listen/src/pages/LibraryCollectionSortDropdown";
import {
  albumSortOptions,
  type AlbumSort,
  type LikedSort,
} from "../../../app/listen/src/pages/library-collection-model";
import { SearchAlbumResultsView } from "../../../app/listen/src/pages/SearchAlbumResultsView";
import { SearchTrackResultsView } from "../../../app/listen/src/pages/SearchTrackResultsView";
import { SearchErrorState } from "../../../app/listen/src/pages/SearchErrorState";
import { SearchNoResultsState } from "../../../app/listen/src/pages/SearchNoResultsState";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import {
  TrackRowPlaybackControl,
  TrackRowPlaybackProgressView,
} from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MoreHorizontal, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { SearchLayersReview } from "./SearchLayersReview";
import "../../../app/listen/src/components/layout/listen-shell.css";
import "../../../app/listen/src/components/layout/listen-shell-metrics.css";

const fixtureI18n = i18next.createInstance();
void fixtureI18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
const fixtureTracks = ["Marea", "Horizonte", "Silencio"];
function ReviewTrack({ title, index }: { title: string; index: number }) {
  const [playing, setPlaying] = useState(false);
  return (
    <TrackRowView active={playing}>
      <TrackRowContent
        title={title}
        details={
          <div className="text-xs text-text-muted">
            Costa Norte · Luz de octubre
          </div>
        }
        duration="3:24"
        quality="FLAC"
        leading={
          <TrackRowPlaybackControl
            index={index + 1}
            disabled={false}
            isActive={playing}
            isPlaying={playing}
            label={playing ? `Pause ${title}` : `Play ${title}`}
            onClick={() => setPlaying(!playing)}
            artwork={
              <MediaCover
                src={IMAGE_SAMPLES[index]}
                alt=""
                className="size-12"
              />
            }
            activeGlyph={
              <TrackRowPlaybackProgressView
                isPlaying={playing}
                currentTime={61}
                duration={204}
              />
            }
          />
        }
        actions={
          <ActionButton label={`More actions for ${title}`} tooltip="More">
            <MoreHorizontal size={CRATE_ICON_SIZE.md} />
          </ActionButton>
        }
      />
    </TrackRowView>
  );
}
function LikedFixture() {
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<LikedSort>("recent"),
    [action, setAction] = useState("");
  const items = fixtureTracks.filter((title) =>
    title.toLowerCase().includes(query.toLowerCase()),
  );
  if (sort === "title") items.sort();
  return (
    <>
      <LibraryLikedView
        items={items}
        itemKey={(title) => title}
        renderRow={(title, index) => (
          <ReviewTrack title={title} index={index} />
        )}
        search={query}
        onSearch={setQuery}
        sort={sort}
        onSort={setSort}
        totalCount={fixtureTracks.length}
        onPlay={() => setAction("Fixture queue requested")}
      />
      <output>{action}</output>
    </>
  );
}
const t = (key: string) => english[key as keyof typeof english] ?? key;
function ShellReviewContent() {
  const location = useLocation(),
    navigate = useNavigate(),
    desktop = useIsDesktop();
  const [expanded, setExpanded] = useState(true),
    [hasTrack, setHasTrack] = useState(false),
    [hero, setHero] = useState(false),
    [scrolled, setScrolled] = useState(false),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState<AlbumSort>("recent");
  const [tab, setTab] = useTabParam(COLLECTION_SECTIONS, "playlists", {
    path: location.pathname.startsWith("/collection/")
      ? {
          value: location.pathname.split("/")[2]!,
          pathname: (next) => `/collection/${next}`,
        }
      : undefined,
  });
  const sections = collectionNavigationItems(t, !desktop, location);
  const navItems = listenNavigationItems(t, !desktop);
  const inCollection =
    location.pathname === "/library" ||
    location.pathname.startsWith("/collection");
  const topBar = (
    <TopBarView
      backLabel="Go back"
      forwardLabel="Go forward"
      onBack={() => navigate(-1)}
      onForward={() => navigate(1)}
      search={
        <SearchInput
          value={query}
          onValueChange={setQuery}
          label="Search"
          placeholder="Search library"
          clearLabel="Clear search"
        />
      }
      userMenu={<Avatar name="Diego" size="md" />}
    />
  );
  const sidebar = (
    <SidebarView expanded={expanded}>
      <SidebarBrand
        expanded={expanded}
        onCollapse={() => setExpanded(false)}
        onExpand={() => setExpanded(true)}
        collapseLabel="Collapse sidebar"
        expandLabel="Expand sidebar"
      />
      <SidebarNavigationView
        expanded={expanded}
        onToggleExpanded={() => setExpanded(!expanded)}
        items={navItems}
        sections={sections}
        collectionLabel="Collection"
        expandLabel="Expand sidebar"
        collectionActive={inCollection}
      />
    </SidebarView>
  );
  const bottomNav = (
    <MobileNavigationView
      items={navItems}
      sections={sections}
      collectionLabel="Collection"
      closeLabel="Close"
      collectionActive={inCollection}
      hasTrack={hasTrack}
    />
  );
  const player = hasTrack ? (
    <div
      data-testid="reserved-player"
      role="status"
      className="z-app-player fixed rounded-panel border border-border-quiet bg-surface-chrome p-3 font-mono text-xs"
      style={{
        left: 16,
        right: 16,
        bottom: desktop
          ? "var(--listen-desktop-player-bottom-offset)"
          : "calc(var(--listen-safe-bottom) + var(--listen-mobile-bottom-dock-inset) + var(--listen-mobile-bottom-nav-content-height))",
        height: desktop
          ? "var(--listen-desktop-player-height)"
          : "var(--listen-mobile-player-height)",
      }}
    >
      Reserved player space · playback stays in 1AZ
    </div>
  ) : null;
  const content = (
    <RouteContent pathname={location.pathname}>
      <div className="grid gap-8">
        <PageHeader
          size="md"
          title="1AY · Listen Shell"
          subtitle="Actual layout/navigation views with local fixture data. No API requests or preference writes."
        />
        <div className="flex flex-wrap items-end gap-4">
          <FormField layout="inline" label="Player space">
            <Checkbox
              checked={hasTrack}
              onCheckedChange={(v) => setHasTrack(v === true)}
            />
          </FormField>
          <FormField layout="inline" label="Overlay header">
            <Checkbox
              checked={hero}
              onCheckedChange={(v) => setHero(v === true)}
            />
          </FormField>
          <FormField layout="inline" label="Scrolled header">
            <Checkbox
              checked={scrolled}
              onCheckedChange={(v) => setScrolled(v === true)}
            />
          </FormField>
        </div>
        <FormField kind="group" label="Current route">
          {(group) => (
            <div
              {...group}
              role="group"
              className="min-w-0 break-all font-mono text-xs"
            >
              <output aria-label="Current route">
                {location.pathname}
                {location.search}
                {location.hash}
              </output>
            </div>
          )}
        </FormField>
        <section className="grid min-w-0 gap-4">
          <SectionHeader title="Collection navigation" />
          <CollectionTabs
            items={COLLECTION_SECTIONS.map((value) => ({
              value,
              count: (
                {
                  artists: 2,
                  albums: 3,
                  liked: 3,
                  playlists: 0,
                  crates: 1,
                } as Partial<Record<typeof value, number>>
              )[value],
              label:
                value === "liked"
                  ? "Liked tracks"
                  : value.charAt(0).toUpperCase() + value.slice(1),
            }))}
            value={tab}
            onValueChange={setTab}
            label="Collection sections"
            visible={desktop}
          >
            {tab === "liked" ? (
              <LikedFixture />
            ) : (
              <div className="grid gap-4">
                <FormField kind="group" label="Sort" className="max-w-xs">
                  {(group) => (
                    <div {...group} role="group">
                      <CollectionSortDropdown
                        label="Sort albums"
                        value={sort}
                        onChange={setSort}
                        options={albumSortOptions}
                      />
                    </div>
                  )}
                </FormField>
                <MediaGrid>
                  {[0, 1, 2].map((index) => (
                    <EntityCard
                      key={index}
                      title={
                        ["Luz de octubre", "Bruma", "Costa de noche"][index]!
                      }
                      subtitle="Local review fixture"
                      layout="grid"
                      shape={tab === "artists" ? "circle" : "square"}
                      artwork={
                        <MediaCover
                          src={IMAGE_SAMPLES[index]}
                          alt=""
                          className="size-full"
                        />
                      }
                      meta={<InfoBadge>{tab}</InfoBadge>}
                    />
                  ))}
                </MediaGrid>
              </div>
            )}
          </CollectionTabs>
        </section>
        <section className="grid gap-6">
          <SearchFormView
            value={query}
            onChange={setQuery}
            onSearch={(q) => navigate(`/search?q=${encodeURIComponent(q)}`)}
            title="Search"
            prompt="Search artists, albums and tracks."
            placeholder="Search artists, albums, tracks..."
            clearLabel="Clear search"
          />
          <SearchAlbumResultsView
            title="Albums (2)"
            items={[0, 1].map((index) => ({
              key: index,
              title: ["Luz de octubre", "Bruma"][index]!,
              subtitle: "Costa Norte",
              href: `/review/album-${index}`,
              artwork: (
                <MediaCover
                  src={IMAGE_SAMPLES[index]}
                  alt=""
                  className="size-full"
                />
              ),
            }))}
          />
          <SearchTrackResultsView
            title="Tracks (3)"
            playLabel="Play all"
            onPlay={() => {}}
            items={fixtureTracks}
            itemKey={(title) => title}
            renderRow={(title, index) => (
              <ReviewTrack title={title} index={index} />
            )}
          />
          <FormField kind="group" label="No results">
            {(group) => (
              <div {...group} role="group">
                <SearchNoResultsState />
              </div>
            )}
          </FormField>
          <FormField kind="group" label="Search error">
            {(group) => (
              <div {...group} role="group">
                <SearchErrorState
                  query="costa"
                  message="Fixture service unavailable"
                  onRetry={() => {}}
                />
              </div>
            )}
          </FormField>
          <SectionHeader title="Search layers and keyboard" />
          <SearchLayersReview />
        </section>
        <Button
          variant="ghost"
          onClick={() => navigate("/library?tab=albums&node=review#saved")}
        >
          Try query-based collection
        </Button>
        <p className="text-sm text-text-muted">
          The live Listen instance validates authenticated artwork and existing
          player. This scene reserves player geometry without recreating its
          controls.
        </p>
      </div>
    </RouteContent>
  );
  return (
    <>
      <SkipLink targetId="listen-main-content">Skip to main content</SkipLink>
      {desktop ? (
        <DesktopShellView
          sidebar={sidebar}
          topBar={topBar}
          player={player}
          desktopContentPadClass={hero ? "pt-0 pb-6" : "py-6"}
          desktopOverlayHeader={hero}
          hasTrack={hasTrack}
          headerOffsetClass={hero ? "" : "pt-24"}
          headerScrolled={scrolled}
          homeDesktopOverlay={false}
          sidebarLeft={expanded ? "left-52" : "left-14"}
          sidebarW={expanded ? "ml-52" : "ml-14"}
        >
          {content}
        </DesktopShellView>
      ) : (
        <MobileShellView
          topBar={topBar}
          player={player}
          bottomNav={bottomNav}
          collectionActive={inCollection}
          hasTrack={hasTrack}
          headerScrolled={scrolled}
          homeMobileOverlay={false}
          homePage={false}
          mobileContentPadClass="py-4 pt-[var(--listen-mobile-page-top)]"
          overlayHeader={hero}
          headerChromeClass={`border-b ${scrolled ? "border-border-quiet" : "border-transparent"} bg-surface-chrome`}
        >
          {content}
        </MobileShellView>
      )}
    </>
  );
}
export function ShellReview() {
  return (
    <I18nextProvider i18n={fixtureI18n}>
      <MemoryRouter
        initialEntries={["/collection/albums?node=review&tab=untouched#saved"]}
      >
        <ShellReviewContent />
      </MemoryRouter>
    </I18nextProvider>
  );
}
