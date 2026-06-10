import { Disc3 } from "lucide-react";

interface TrackActionMenuHeaderProps {
  album?: string;
  artist: string;
  coverUrl?: string;
  title: string;
}

export function TrackActionMenuHeader({
  album,
  artist,
  coverUrl,
  title,
}: TrackActionMenuHeaderProps) {
  return (
    <div className="mb-2 border-b border-white/10 pb-3 pl-3 pr-2">
      <div className="flex items-center gap-3">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-white/10">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={album ? `${title} cover` : title}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Disc3 size={18} className="text-white/55" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {title}
          </p>
          <p className="truncate text-xs text-muted-foreground">{artist}</p>
          {album ? (
            <p className="truncate text-[11px] text-white/55">{album}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
