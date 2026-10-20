import { PageHeader } from "@crate/ui/domain/navigation";
import type { ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { Calendar, Sparkles } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { Card } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { StatNumber } from "@crate/ui/primitives/StatNumber";

import type { TFunction } from "i18next";
import type { ShowsFilter, ShowsPageModel } from "./shows-page-model";
export interface ShowsPagePresentation extends ShowsPageModel {
  filter: ShowsFilter;
  search: string;
  setFilter: (value: ShowsFilter) => void;
  setSearch: (value: string) => void;
  genreName?: string;
  genreSlug: string | null;
  t: TFunction;
  hasData: boolean;
  error: string | null;
  status: number | null | undefined;
  refetch: () => void;
}

interface ShowsSectionProps {
  page: ShowsPagePresentation;
}
export interface ShowsPageViewProps extends ShowsSectionProps {
  renderFeatured: (
    item: NonNullable<ShowsPagePresentation["featuredShow"]>,
  ) => ReactNode;
  renderMonths: (items: ShowsPagePresentation["comingUp"]) => ReactNode;
}

function ShowsHeader({ page }: ShowsSectionProps) {
  const headingCopy = page.isGenreRadar
    ? page.t("radar.genreIntro", { genre: page.genreName || page.genreSlug })
    : page.t("radar.intro");

  return (
    <PageHeader
      title={page.t("nav.radar")}
      subtitle={headingCopy}
      actions={<ShowsSummary page={page} />}
    />
  );
}

function ShowsSummary({ page }: ShowsSectionProps) {
  if (
    !page.summary ||
    !page.hasData ||
    page.loading ||
    (page.isGenreRadar && page.status === 404)
  )
    return null;

  return (
    <ul
      aria-label={page.t("radar.summaryAria")}
      className="hidden list-none flex-wrap items-end gap-6 md:flex"
    >
      {page.isGenreRadar ? (
        <SummaryPill
          label={page.t("radar.summary.shows")}
          value={page.summary.show_count}
        />
      ) : (
        <>
          <SummaryPill
            label={page.t("radar.summary.followedArtists")}
            value={page.summary.followed_artists}
          />
          <SummaryPill
            label={page.t("radar.summary.shows")}
            value={page.summary.show_count}
          />
          <SummaryPill
            label={page.t("radar.summary.releases")}
            value={page.summary.release_count}
          />
          <SummaryPill
            label={page.t("radar.summary.attending")}
            value={page.summary.attending_count}
          />
        </>
      )}
    </ul>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <li className="border-l border-border-quiet pl-4">
      <StatNumber value={value} label={label} size="sm" />
    </li>
  );
}

function ShowsFeatured({ page, renderFeatured }: ShowsPageViewProps) {
  if (!page.featuredShow) return null;

  return (
    <FormField
      kind="group"
      label={<MonoLabel as="h2" accent={page.t("radar.sections.nextShow")} />}
    >
      {(group) => (
        <section {...group}>{renderFeatured(page.featuredShow!)}</section>
      )}
    </FormField>
  );
}

const SHOW_FILTERS: ShowsFilter[] = ["all", "shows", "releases"];

function ShowsFilters({ page }: ShowsSectionProps) {
  return (
    <Card className="p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px] md:items-start">
        <FormField kind="group" label={page.t("radar.filtersLabel")}>
          {(group) => (
            <div {...group} role="group">
              <SegmentedControl
                as="radio"
                variant="tonal"
                label={page.t("radar.filtersLabel")}
                items={SHOW_FILTERS.map((value) => ({
                  value,
                  label: filterLabel(page, value),
                }))}
                value={page.filter}
                onValueChange={page.setFilter}
              />
            </div>
          )}
        </FormField>
        <FormField label={page.t("search.label")}>
          {(control) => (
            <SearchInput
              {...control}
              value={page.search}
              onValueChange={page.setSearch}
              label={page.t("search.label")}
              clearLabel={page.t("common.clear")}
              placeholder={page.t("radar.searchPlaceholder")}
            />
          )}
        </FormField>
      </div>
    </Card>
  );
}

function filterLabel(page: ShowsPagePresentation, filter: ShowsFilter) {
  if (filter === "all") return page.t("radar.filters.all");
  if (filter === "shows") return page.t("radar.filters.shows");
  return page.t("radar.filters.releases");
}

function ShowsEmptyStates({ page }: ShowsSectionProps) {
  if (page.loading) {
    return (
      <LoadingState label={page.t("common.loadingShort")} className="py-24" />
    );
  }
  if (page.isGenreRadar && page.status === 404) {
    return <EmptyState title={page.t("genre.notFound")} titleAs="h2" />;
  }
  if (!page.hasData && page.error) {
    return (
      <ErrorState
        title={page.t("radar.unavailable")}
        retryLabel={page.t("common.retry")}
        onRetry={page.refetch}
      />
    );
  }
  if (page.isGenreRadar && page.items.length === 0) {
    return (
      <EmptyState
        titleAs="h2"
        icon={Calendar}
        title={page.t("radar.empty.genreTitle")}
        description={page.t("radar.empty.genreBody")}
      />
    );
  }
  if (!page.isGenreRadar && !page.hasFollowedArtists) {
    return (
      <EmptyState
        titleAs="h2"
        icon={Sparkles}
        title={page.t("radar.empty.followTitle")}
        description={page.t("radar.empty.followBody")}
      />
    );
  }
  if (
    !page.isGenreRadar &&
    page.hasFollowedArtists &&
    page.items.length === 0
  ) {
    return (
      <EmptyState
        titleAs="h2"
        icon={Sparkles}
        title={page.t("radar.empty.noSignalsTitle")}
        description={page.t("radar.empty.noSignalsBody")}
      />
    );
  }
  if (
    page.hasFollowedArtists &&
    page.items.length > 0 &&
    page.filtered.length === 0
  ) {
    return (
      <EmptyState
        titleAs="h2"
        icon={Calendar}
        title={page.t("radar.empty.filteredTitle")}
        description={page.t("radar.empty.filteredBody")}
      />
    );
  }
  return null;
}

function ShowsResults({ page, renderMonths }: ShowsPageViewProps) {
  if (page.loading || !page.hasFollowedArtists || page.filtered.length === 0) {
    return null;
  }

  return (
    <div className="space-y-10">
      <ShowsMonthSection
        items={page.comingUp}
        monthTitle={page.t("radar.sections.comingUp")}
        page={page}
        renderMonths={renderMonths}
      />
      <ShowsMonthSection
        items={page.recentlyReleased}
        muted
        monthTitle={page.t("radar.sections.recentlyReleased")}
        page={page}
        renderMonths={renderMonths}
      />
    </div>
  );
}

function ShowsMonthSection({
  items,
  monthTitle,
  muted = false,
  renderMonths,
}: Pick<ShowsPageViewProps, "page" | "renderMonths"> & {
  items: ShowsPagePresentation["comingUp"];
  monthTitle: string;
  muted?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <FormField
      kind="group"
      label={
        <MonoLabel as="h2" accent={muted ? undefined : monthTitle}>
          {muted ? monthTitle : undefined}
        </MonoLabel>
      }
    >
      {(group) => (
        <section {...group} className="grid min-w-0 gap-8">
          {renderMonths(items)}
        </section>
      )}
    </FormField>
  );
}

export function ShowsPageView(props: ShowsPageViewProps) {
  const { page } = props;
  const unread =
    page.loading || !page.hasData || (page.isGenreRadar && page.status === 404);
  return (
    <div className="grid min-w-0 gap-6">
      <ShowsHeader page={page} />
      {!unread && (
        <>
          <ShowsFeatured {...props} />
          <ShowsFilters page={page} />
        </>
      )}
      <ShowsEmptyStates page={page} />
      {!unread && <ShowsResults {...props} />}
    </div>
  );
}
