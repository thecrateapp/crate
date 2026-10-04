import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

import type { SearchTrackResult } from "@/components/playlists/playlist-composer-model";
import { searchTrackKey } from "@/components/playlists/playlist-composer-model";

export function PlaylistTrackSearch({
  search,
  searching,
  results,
  t,
  onSearchChange,
  onAddTrack,
}: {
  search: string;
  searching: boolean;
  results: SearchTrackResult[];
  t: ReturnType<typeof useTranslation>["t"];
  onSearchChange: (value: string) => void;
  onAddTrack: (track: SearchTrackResult) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchInput
          label={t("playlistComposer.searchPlaceholder")}
          clearLabel={t("search.clear")}
          placeholder={t("playlistComposer.searchPlaceholder")}
          value={search}
          onValueChange={onSearchChange}
          className="rounded-xl bg-text-primary/5 placeholder:text-text-muted md:text-base"
        />
        {searching ? (
          <Loader2
            size={CRATE_ICON_SIZE.xs}
            className="pointer-events-none absolute top-1/2 right-11 -translate-y-1/2 animate-spin text-accent-action"
          />
        ) : null}
      </div>

      {search.trim().length >= 2 ? (
        <div className="rounded-xl border border-border-quiet bg-text-primary/5">
          {results.length > 0 ? (
            <div className="max-h-44 overflow-y-auto py-1.5">
              {results.map((track) => (
                <button
                  key={searchTrackKey(track)}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-text-primary/5"
                  onClick={() => onAddTrack(track)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text-primary">
                      {track.title}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {track.artist} · {track.album}
                    </div>
                  </div>
                  <span className="text-xs text-accent-action">
                    {t("common.add")}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-sm text-text-muted">
              {t("playlistComposer.noTracksFound")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
