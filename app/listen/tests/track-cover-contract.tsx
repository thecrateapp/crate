// Browser fixture only: actual managed image renderer with a local data source, no App/API.
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import { WindowVirtualList } from "../src/components/ui/WindowVirtualList";
import { createRoot } from "react-dom/client";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { TrackCoverThumb } from "../src/components/artwork/TrackCoverThumb";
import { TrackRowView } from "../src/components/cards/TrackRowView";
import { TrackRowContent } from "../src/components/cards/TrackRowContent";
import { TrackRowPlaybackControl } from "../src/components/cards/TrackRowPlaybackControl";
import "../src/index.css";
applyCrateIdentity();
const src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#134e4a"/></svg>')}`;
createRoot(document.getElementById("root")!).render(
  <main>
    {(["default", "compact"] as const).map((density) => (
      <TrackRowView
        key={density}
        density={density}
        aria-label={`${density} managed cover`}
      >
        <TrackRowContent
          title="Marea"
          actions={null}
          leading={
            <TrackRowPlaybackControl
              disabled={false}
              index={1}
              isActive={false}
              isPlaying={false}
              label={`Play ${density}`}
              onClick={() => {}}
              artwork={
                <TrackCoverThumb
                  src={src}
                  alt={`${density} artwork`}
                  className="absolute inset-0 rounded-md"
                />
              }
            />
          }
        />
      </TrackRowView>
    ))}
    <TrackList
      label="Virtualized library"
      items={Array.from({ length: 80 }, (_, index) => ({
        id: `entry-${index}`,
        title: `Recording ${index}`,
      }))}
      itemKey={(item) => item.id}
      virtualList={WindowVirtualList}
      estimateSize={60}
      overscan={2}
      renderRow={(item) => (
        <TrackRowView aria-label={item.title}>
          <TrackRowContent leading={null} title={item.title} actions={null} />
        </TrackRowView>
      )}
    />
  </main>,
);
