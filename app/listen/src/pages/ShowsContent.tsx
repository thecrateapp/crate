import type { ReactNode } from "react";

import { PageHeader } from "@crate/ui/domain/navigation";
import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import { Calendar, Sparkles } from "@crate/ui/icons";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";

import {
  groupByMonth,
  UpcomingMonthGroup,
  ShowCard,
} from "@/components/upcoming/UpcomingRows";
import { cn } from "@/lib/utils";
import type { ShowsFilter } from "@/pages/shows-page-model";
import type { ShowsPageController } from "@/pages/use-shows-page-controller";

interface ShowsSectionProps {
  page: ShowsPageController;
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
  if (!page.summary) return null;

  return (
    <ul
      aria-label={page.t("radar.summaryAria")}
      className="hidden list-none flex-wrap items-center gap-2 md:flex"
    >
      {page.isGenreRadar ? (
        <SummaryPill
          label={page.t("radar.summary.shows")}
          value={page.summary.show_count}
          accent="cyan"
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
            accent="cyan"
          />
          <SummaryPill
            label={page.t("radar.summary.releases")}
            value={page.summary.release_count}
            accent="cyan"
          />
          <SummaryPill
            label={page.t("radar.summary.attending")}
            value={page.attendingShows.length}
            accent="cyan"
          />
        </>
      )}
    </ul>
  );
}

function SummaryPill({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: number;
  accent?: "neutral" | "cyan";
}) {
  const accentClass =
    accent === "cyan"
      ? "border-accent-action/20 text-accent-action"
      : "border-border-quiet text-text-primary/60";

  return (
    <li
      className={cn(
        "rounded-lg border bg-text-primary/[0.03] px-3 py-2",
        accentClass,
      )}
    >
      <div className="text-xs uppercase tracking-[0.16em] opacity-70">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </li>
  );
}

function ShowsFeatured({ page }: ShowsSectionProps) {
  if (!page.featuredShow) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Calendar size={15} className="text-accent-action" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-accent-action">
          {page.t("radar.sections.nextShow")}
        </h2>
      </div>
      <ShowCard item={page.featuredShow} variant="feature" />
    </section>
  );
}

const SHOW_FILTERS: ShowsFilter[] = ["all", "shows", "releases"];

function ShowsFilters({ page }: ShowsSectionProps) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-text-primary/5 bg-text-primary/[0.02] p-4 md:flex-row md:items-center md:justify-between">
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
        className="flex-wrap gap-2 p-0"
        itemClassName="h-auto border border-border-quiet px-4 py-2 font-normal text-text-muted hover:border-text-primary/20 data-[state=active]:border-accent-action/40 data-[state=active]:bg-accent-action/15 data-[state=active]:text-accent-action"
      />
      <div className="relative w-full md:w-[280px]">
        <SearchInput
          value={page.search}
          onValueChange={page.setSearch}
          label={page.t("radar.searchPlaceholder")}
          clearLabel={page.t("common.clear")}
          placeholder={page.t("radar.searchPlaceholder")}
          className="rounded-lg focus-visible:border-accent-action/40 md:text-base"
        />
      </div>
    </div>
  );
}

function filterLabel(page: ShowsPageController, filter: ShowsFilter) {
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

function ShowsResults({ page }: ShowsSectionProps) {
  if (page.loading || !page.hasFollowedArtists || page.filtered.length === 0) {
    return null;
  }

  return (
    <div className="space-y-10">
      <ShowsMonthSection
        icon={<Sparkles size={15} className="text-accent-action" />}
        items={page.comingUp}
        monthTitle={page.t("radar.sections.comingUp")}
        page={page}
      />
      <ShowsMonthSection
        icon={<Calendar size={15} className="text-text-muted" />}
        items={page.recentlyReleased}
        muted
        monthTitle={page.t("radar.sections.recentlyReleased")}
        page={page}
      />
    </div>
  );
}

function ShowsMonthSection({
  icon,
  items,
  monthTitle,
  muted = false,
  page,
}: ShowsSectionProps & {
  icon: ReactNode;
  items: ShowsPageController["comingUp"];
  monthTitle: string;
  muted?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2
          className={cn(
            "text-sm font-semibold uppercase tracking-[0.18em]",
            muted ? "text-text-muted" : "text-accent-action",
          )}
        >
          {monthTitle}
        </h2>
      </div>
      <div className="space-y-8">
        {groupByMonth(items).map(([month, monthItems]) => (
          <UpcomingMonthGroup
            key={month}
            month={month}
            items={monthItems}
            expandedId={page.expandedId}
            onToggleExpand={page.setExpandedId}
          />
        ))}
      </div>
    </section>
  );
}

export function ShowsContent({ page }: ShowsSectionProps) {
  return (
    <div className="space-y-6">
      <ShowsHeader page={page} />
      <ShowsFeatured page={page} />
      <ShowsFilters page={page} />
      <ShowsEmptyStates page={page} />
      <ShowsResults page={page} />
    </div>
  );
}
