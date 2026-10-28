import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { CatalogSearchView } from "../../../app/listen/src/components/search/CatalogSearchView";
import type { CatalogSearchKind } from "../../../app/listen/src/components/search/catalog-search-model";
import { TopBarSearchDropdownView } from "../../../app/listen/src/components/layout/topbar/TopBarSearchDropdownView";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";

function GlobalLoading() {
  const { t } = useTranslation();
  const anchor = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 240,
  });
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (box)
        setPosition({
          left: box.left,
          top: box.bottom + 8,
          width: box.width,
          maxHeight: 240,
        });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);
  return (
    <div ref={anchor}>
      <Button
        variant="outline"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Toggle global search loading
      </Button>
      {open && position.width > 0 ? (
        <TopBarSearchDropdownView
          listboxId="review-global-search"
          loading
          dropdownRef={dropdownRef}
          dropdownStyle={position}
          visibility={{
            showResults: false,
            showRecents: false,
            showSearchError: false,
            showEmptyResults: false,
          }}
          results={[]}
          recents={[]}
          activeIdx={-1}
          trimmedQuery=""
          searchError={null}
          onSelectItem={async () => {}}
          onSelectRecent={() => {}}
          onSeeAllResults={() => {}}
          t={t}
          renderThumb={() => null}
        />
      ) : null}
    </div>
  );
}
export function SearchLoadingReview() {
  return (
    <SettingsFixtureProvider>
      <section
        id="search-loading"
        className="grid min-w-0 gap-6"
        aria-label="Search loading review"
      >
        <SectionHeader
          title="Finding your music"
          subtitle="Actual domain and global search views. The beam fills the available panel width; existing results remain available during refresh."
        />
        <FormField label="Global search panel" kind="group">
          {(control) => (
            <div {...control} role="group">
              <GlobalLoading />
            </div>
          )}
        </FormField>
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          {([undefined, ["album"], ["artist"], ["track"]] as const).map(
            (kinds, index) => (
              <CatalogSearchView
                key={index}
                label={kinds ? `Search ${kinds[0]}s` : "Search music"}
                query="High Vis"
                onQueryChange={() => {}}
                kinds={kinds as readonly CatalogSearchKind[] | undefined}
                items={[]}
                searching
              />
            ),
          )}
        </div>
      </section>
    </SettingsFixtureProvider>
  );
}
