import { SectionHeader } from "@crate/ui/domain/lists";
import { TrackList, type TrackListProps } from "@crate/ui/domain/tracks";
import { Button } from "@crate/ui/shadcn/button";
import { CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
export function SearchTrackResultsView<T>({
  title,
  playLabel,
  onPlay,
  ...list
}: Pick<TrackListProps<T>, "items" | "itemKey" | "renderRow"> & {
  title: string;
  playLabel: string;
  onPlay: () => void;
}) {
  return (
    <section className="space-y-3">
      <SectionHeader
        title={title}
        action={
          <Button onClick={onPlay}>
            <Play size={CRATE_ICON_SIZE.sm} fill="currentColor" />
            {playLabel}
          </Button>
        }
      />
      <TrackList {...list} />
    </section>
  );
}
