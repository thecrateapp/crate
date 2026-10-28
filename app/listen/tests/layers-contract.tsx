// Browser-only integration fixture: real controllers/consumers, no App/auth/backend startup.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { Button } from "@crate/ui/shadcn/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { SkipLink } from "@crate/ui/primitives/SkipLink";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { TopBarSearchInput } from "../src/components/layout/topbar/TopBarSearchView";
import {
  useTopBarSearchState,
  useTopBarSearchLifecycle,
  useTopBarSearchSelection,
} from "../src/components/layout/topbar/TopBarSearchController";
import { CollectionSortDropdown } from "../src/pages/LibraryCollectionSortDropdown";
import { PlaylistCreateModal } from "../src/components/playlists/PlaylistCreateModal";
import { RouteSpinner } from "../src/app-shell/AppFallbacks";
import { useTabParam } from "../src/hooks/use-tab-param";
import "../src/index.css";
applyCrateIdentity();
const tabs = ["albums", "tracks"] as const;
const tracks: [] = [];
function SearchFixture() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useTopBarSearchState();
  const searchOpen =
    state.expanded || state.showDropdown || Boolean(state.query.trim());
  const lifecycle = useTopBarSearchLifecycle({ ...state, searchOpen });
  useEffect(() => {
    if (state.query.trim()) {
      state.setExpanded(true);
      state.setShowDropdown(true);
    }
  }, [state.query, state.setExpanded, state.setShowDropdown]);
  useDismissibleLayer({
    active: state.showDropdown,
    refs: [lifecycle.containerRef, lifecycle.dropdownRef],
    closeOnEscape: false,
    onDismiss: () => state.setShowDropdown(false),
  });
  const handlers = useTopBarSearchSelection({
    ...state,
    navigate,
    play: () => {},
    t,
    ...lifecycle,
  });
  return (
    <TopBarSearchInput
      state={{ ...state, searchOpen }}
      environment={{ canHover: false, isDesktop: true }}
      refs={{ ...lifecycle }}
      actions={{ ...state, ...lifecycle }}
      handlers={handlers}
      navigate={navigate}
      t={t}
    />
  );
}
function Fixture() {
  const [tab, setTab] = useTabParam(tabs, "albums");
  const location = useLocation();
  const navigate = useNavigate();
  const [sort, setSort] = useState("recent");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState("");
  return (
    <>
      <SkipLink targetId="fixture-main">Skip to main content</SkipLink>
      <header className="flex flex-wrap items-center gap-4 p-6">
        <SearchFixture />
        <CollectionSortDropdown
          label="Sort albums"
          value={sort}
          onChange={setSort}
          options={[
            { value: "recent", labelKey: "library.sort.recent" },
            { value: "name", labelKey: "common.name" },
          ]}
        />
      </header>
      <main id="fixture-main" tabIndex={-1} className="grid gap-6 p-6">
        <Button onClick={() => setOpen(true)}>Create fixture playlist</Button>
        <Button onClick={() => setBusy(!busy)}>Toggle busy</Button>
        <PlaylistCreateModal
          open={open}
          initialTracks={tracks}
          initialName={
            location.search.includes("long=1")
              ? "A playlist name with words that must wrap across narrow layouts ".repeat(
                  3,
                )
              : "Costa de noche"
          }
          initialDescription={
            location.search.includes("long=1")
              ? "A long playlist description that must remain readable without overlapping the following settings. ".repeat(
                  6,
                )
              : ""
          }
          submitting={busy}
          onClose={() => setOpen(false)}
          onSubmit={async (next) => {
            setPayload(JSON.stringify(next));
            setOpen(false);
          }}
        />
        <output aria-label="Submitted playlist">{payload}</output>
        <output aria-label="Sort value">{sort}</output>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Fixture collection">
            <TabsTrigger value="albums">Albums</TabsTrigger>
            <TabsTrigger value="tracks">Tracks</TabsTrigger>
          </TabsList>
          <TabsContent value="albums">Album panel</TabsContent>
          <TabsContent value="tracks">Track panel</TabsContent>
        </Tabs>
        <Button onClick={() => navigate(-1)}>History back</Button>
        <Button onClick={() => navigate(1)}>History forward</Button>
        <output aria-label="Location">
          {location.pathname}
          {location.search}
          {location.hash}
        </output>
        <RouteSpinner />
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nProvider initialLocale="en">
    <BrowserRouter>
      <Fixture />
    </BrowserRouter>
  </I18nProvider>,
);
