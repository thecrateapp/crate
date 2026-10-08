import type { CastQueueItem } from "@crate/cast-protocol";

interface QueuePreviewProps {
  currentIndex: number;
  items: CastQueueItem[];
}

export function QueuePreview({ currentIndex, items }: QueuePreviewProps) {
  const upcoming = items.slice(currentIndex + 1, currentIndex + 4);
  return (
    <aside className="queue-preview" aria-label="Up next">
      <div className="section-label">Up next</div>
      {upcoming.length ? (
        <ol>
          {upcoming.map((item, index) => (
            <li key={item.itemId}>
              <span className="queue-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="queue-copy">
                <strong>{item.title}</strong>
                <span>{item.artist}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="queue-empty">Queue complete</p>
      )}
    </aside>
  );
}
