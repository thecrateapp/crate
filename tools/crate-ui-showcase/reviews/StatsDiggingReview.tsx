import { MemoryRouter } from "react-router";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import { StatsOverviewReview } from "./StatsOverviewReview";
import { PageHeader } from "@crate/ui/domain/navigation";
import { SearchLoadingReview } from "./SearchLoadingReview";
import { SkeletonsReview } from "./SkeletonsReview";

export function StatsDiggingReview() {
  return (
    <main className="mx-auto grid min-w-0 max-w-content gap-8 px-4 py-6 sm:px-8">
      <PageHeader
        eyebrow="1BE · Review"
        title="Stats, Crate Digging and loading"
        subtitle="Actual shared and Listen views, with local data and callbacks."
      />
      <MemoryRouter>
        <SettingsFixtureProvider>
          <StatsOverviewReview />
        </SettingsFixtureProvider>
      </MemoryRouter>
      <SearchLoadingReview />
      <SkeletonsReview />
    </main>
  );
}
