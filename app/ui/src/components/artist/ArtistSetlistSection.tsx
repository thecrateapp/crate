import { useNavigate } from "react-router";
import { fuzzyMatchTrack } from "@/components/artist/ArtistPageBits";
import { api } from "@/lib/api";
import { albumPagePath, artistActionApiPath } from "@/lib/library-routes";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { ArtistDetailSection } from "./ArtistDetailSection";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { RefreshCw } from "@crate/ui/icons";
import { toast } from "sonner";

interface SetlistSong {
  title: string;
  frequency: number;
  play_count: number;
  last_played?: string;
}

interface SetlistData {
  probable_setlist?: SetlistSong[];
  total_shows?: number;
  last_show?: { date: string; venue: string; city: string };
}

interface LibraryTrackTitle {
  title: string;
  album: string;
  path: string;
  album_id?: number;
  album_slug?: string;
}

interface ArtistSetlistSectionProps {
  artistName: string;
  artistId?: number;
  artistEntityUid?: string;
  setlistData?: SetlistData;
  allTrackTitles: LibraryTrackTitle[];
  onTrackTitlesLoaded: (tracks: LibraryTrackTitle[]) => void;
  canRefresh?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}

function normalizeSetlistSongs(value: unknown): SetlistSong[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((song) => {
    if (!song || typeof song !== "object") return [];
    const item = song as Partial<SetlistSong> & { name?: unknown };
    const title =
      typeof item.title === "string"
        ? item.title.trim()
        : typeof item.name === "string"
          ? item.name.trim()
          : "";
    if (!title) return [];
    const normalized: SetlistSong = {
      title,
      frequency:
        typeof item.frequency === "number" && Number.isFinite(item.frequency)
          ? item.frequency
          : 1,
      play_count:
        typeof item.play_count === "number" && Number.isFinite(item.play_count)
          ? item.play_count
          : 1,
    };
    if (typeof item.last_played === "string") {
      normalized.last_played = item.last_played;
    }
    return [normalized];
  });
}

export function ArtistSetlistSection({
  artistName,
  artistId,
  artistEntityUid,
  setlistData,
  allTrackTitles,
  onTrackTitlesLoaded,
  canRefresh = false,
  refreshing = false,
  onRefresh,
}: ArtistSetlistSectionProps) {
  const navigate = useNavigate();
  const probableSetlist = normalizeSetlistSongs(setlistData?.probable_setlist);
  const lastShow = setlistData?.last_show;
  const totalShows = setlistData?.total_shows ?? 0;

  async function ensureTrackTitles() {
    const endpoint = artistActionApiPath(
      { artistId, artistEntityUid },
      "track-titles",
    );
    if (!endpoint) return [];
    if (allTrackTitles.length > 0) return allTrackTitles;
    try {
      const tracks = await api<LibraryTrackTitle[]>(endpoint);
      if (Array.isArray(tracks)) {
        onTrackTitlesLoaded(tracks);
        return tracks;
      }
    } catch {
      // Surface the user-facing error at the call site instead.
    }
    return [];
  }

  return (
    <ArtistDetailSection
      title="Probable Setlist"
      description={
        probableSetlist.length > 0 ? (
          <>
            Based on {totalShows} recent concerts
            {lastShow
              ? ` · Last show: ${lastShow.date} at ${lastShow.venue}, ${lastShow.city}`
              : ""}
          </>
        ) : (
          "Predicted from recent Setlist.fm concerts"
        )
      }
      actions={
        canRefresh && onRefresh ? (
          <ActionButton
            label={refreshing ? "Refreshing setlist" : "Refresh setlist"}
            loading={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw
              data-admin-ux="artist-refresh-setlist"
              aria-hidden="true"
            />
          </ActionButton>
        ) : undefined
      }
    >
      {probableSetlist.length === 0 ? (
        <EmptyState title="No concert data available from Setlist.fm" />
      ) : (
        <HairlineList
          label="Probable setlist"
          ruled={false}
          className="max-w-4xl"
        >
          {probableSetlist.map((song, index) => {
            const match = fuzzyMatchTrack(song.title, allTrackTitles);
            const frequency = Math.max(0, Math.min(1, song.frequency));
            return (
              <HairlineRow
                key={song.title}
                index={index + 1}
                muted={!match}
                truncate={false}
                asChild
                trailing={
                  <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-12">
                        <ProgressHairline
                          label={`${song.title} frequency`}
                          value={frequency}
                        />
                      </span>
                      <MonoLabel as="span">
                        {Math.round(frequency * 100)}%
                      </MonoLabel>
                    </span>
                    <MonoLabel as="span">{song.play_count} plays</MonoLabel>
                    {song.last_played ? (
                      <MonoLabel as="span" className="hidden sm:inline">
                        {song.last_played}
                      </MonoLabel>
                    ) : null}
                  </span>
                }
              >
                <button
                  type="button"
                  disabled={!match}
                  onClick={() => {
                    if (match)
                      navigate(
                        albumPagePath({
                          albumId: match.album_id,
                          albumSlug: match.album_slug,
                          artistName,
                          albumName: match.album,
                        }),
                      );
                    else
                      void ensureTrackTitles().catch(() =>
                        toast.error("Failed to load artist tracks"),
                      );
                  }}
                  className="disabled:cursor-default hover:enabled:bg-text-primary/5 focus-visible:outline-2 focus-visible:outline-focus-ring"
                >
                  <span className="text-sm">{song.title}</span>
                </button>
              </HairlineRow>
            );
          })}
        </HairlineList>
      )}
    </ArtistDetailSection>
  );
}
