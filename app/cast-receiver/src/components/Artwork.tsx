import type { CastQueueItem } from "@crate/cast-protocol";

interface ArtworkProps {
  item: CastQueueItem;
}

export function Artwork({ item }: ArtworkProps) {
  const artworkUrl = item.resources?.artworkUrl;
  return (
    <div className="artwork-shell">
      <div
        aria-label="No cover artwork available"
        className="artwork-fallback"
        role="img"
      >
        <span>{item.artist.slice(0, 1).toUpperCase()}</span>
      </div>
      {artworkUrl ? (
        <img
          alt={`Cover of ${item.album || item.title}`}
          className="artwork-image"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          src={artworkUrl}
        />
      ) : null}
    </div>
  );
}
