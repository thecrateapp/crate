import {
  groupByMonth,
  ShowCard,
  UpcomingMonthGroup,
} from "@/components/upcoming/UpcomingRows";
import type { ShowsPageController } from "./use-shows-page-controller";
import { ShowsPageView } from "./ShowsPageView";
export function ShowsContent({ page }: { page: ShowsPageController }) {
  return (
    <ShowsPageView
      page={page}
      renderFeatured={(item) => (
        <ShowCard
          item={item}
          variant="feature"
          onAttendanceChange={page.refetch}
        />
      )}
      renderMonths={(items) =>
        groupByMonth(items).map(([month, monthItems]) => (
          <UpcomingMonthGroup
            key={month}
            month={month}
            items={monthItems}
            expandedId={page.expandedId}
            onToggleExpand={page.setExpandedId}
            onAttendanceChange={page.refetch}
          />
        ))
      }
    />
  );
}
