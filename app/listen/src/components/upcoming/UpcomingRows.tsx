import { useState } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { ReleaseRow } from "@/components/upcoming/ReleaseRow";
import { ShowCard } from "@/components/upcoming/ShowCard";
import {
  artistShowToUpcomingItem,
  formatMonthLabel,
  groupByMonth,
  itemKey,
  type ArtistShowEvent,
  type UpcomingItem,
} from "@/components/upcoming/upcoming-model";

export {
  artistShowToUpcomingItem,
  groupByMonth,
  itemKey,
  type ArtistShowEvent,
  type UpcomingItem,
  ReleaseRow,
  ShowCard,
};

export function UpcomingMonthGroup({
  month,
  items,
  expandedId,
  onToggleExpand,
}: {
  month: string;
  items: UpcomingItem[];
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
}) {
  const [attendanceOverrides, setAttendanceOverrides] = useState<
    Record<string, boolean>
  >({});

  return (
    <div className="space-y-2">
      <MonoLabel as="div" className="border-b border-border-quiet pb-2">
        {formatMonthLabel(month)}
      </MonoLabel>
      <div className="space-y-2">
        {items.map((item, index) => {
          const key = itemKey(item, index);
          const itemWithOverrides =
            attendanceOverrides[key] == null
              ? item
              : { ...item, user_attending: attendanceOverrides[key] };

          if (item.type === "show") {
            return (
              <ShowCard
                key={key}
                item={itemWithOverrides}
                expanded={expandedId === key}
                onToggle={() => onToggleExpand(expandedId === key ? null : key)}
                onAttendanceChange={(attending) => {
                  setAttendanceOverrides((current) => ({
                    ...current,
                    [key]: attending,
                  }));
                }}
              />
            );
          }

          return <ReleaseRow key={key} item={itemWithOverrides} />;
        })}
      </div>
    </div>
  );
}
