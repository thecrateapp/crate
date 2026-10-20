import { useState } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { CatalogSearchView } from "../../../app/listen/src/components/search/CatalogSearchView";
import {
  catalogAlbumItem,
  catalogArtistItem,
  catalogTrackItem,
  type CatalogSearchItem,
  type CatalogSearchKind,
} from "../../../app/listen/src/components/search/catalog-search-model";
import { PlaylistComposerTrackListView } from "../../../app/listen/src/components/playlists/PlaylistComposerTrackListView";
import {
  getTrackKey,
  mergeUniqueTracks,
  toComposerTrack,
  type PlaylistComposerTrack,
  type SearchTrackResult,
} from "../../../app/listen/src/components/playlists/playlist-composer-model";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
const track: SearchTrackResult = {
  title: "Talk For Hours",
  artist: "High Vis",
  album: "Blending",
  duration: 183,
  global_track_uid: "track-one",
  global_album_uid: "album-one",
  cover: IMAGE_SAMPLES[0],
};
const album = {
  name: "Blending",
  artist: "High Vis",
  year: 2022,
  global_album_uid: "album-one",
};
const artist = { name: "High Vis", global_artist_uid: "artist-one" };
const items: CatalogSearchItem<
  SearchTrackResult | typeof album | typeof artist
>[] = [
  catalogTrackItem(track),
  { ...catalogAlbumItem(album), imageUrl: IMAGE_SAMPLES[0] },
  { ...catalogArtistItem(artist), imageUrl: IMAGE_SAMPLES[1] },
];
function Scene({
  initialKinds = ["track", "album", "artist"],
}: {
  initialKinds?: CatalogSearchKind[];
}) {
  const { t } = useTranslation();
  const [kinds, setKinds] = useState(initialKinds),
    [query, setQuery] = useState("High Vis"),
    [state, setState] = useState("ready");
  const [tracks, setTracks] = useState<PlaylistComposerTrack[]>([]),
    [action, setAction] = useState("Select a result");
  const visible =
    state === "empty"
      ? []
      : items.filter((item) =>
          [item.title, item.subtitle]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
        );
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <PageHeader
        eyebrow="Checkpoint 1BB · search and playlist artwork"
        title="Catalog search"
        subtitle="One Listen domain search for tracks, albums and artists. Actual production views; local fixtures without API or playlist writes."
      />
      <FormField label="Result types" kind="group">
        {(control) => (
          <div {...control} role="group" className="flex flex-wrap gap-4">
            {(["track", "album", "artist"] as const).map((kind) => (
              <FormField key={kind} label={kind} layout="inline">
                <Checkbox
                  checked={kinds.includes(kind)}
                  onCheckedChange={(checked) =>
                    setKinds((current) =>
                      checked
                        ? [...current, kind]
                        : current.filter((value) => value !== kind),
                    )
                  }
                />
              </FormField>
            ))}
          </div>
        )}
      </FormField>
      <FormField label="Read state">
        {(control) => (
          <Select value={state} onValueChange={setState}>
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["ready", "loading", "error", "empty"].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      <CatalogSearchView
        label="Search catalog"
        query={query}
        onQueryChange={setQuery}
        kinds={kinds}
        items={visible}
        searching={state === "loading"}
        error={state === "error" ? "Catalog search failed" : undefined}
        onRetry={() => setState("ready")}
        onSelect={(item) => {
          setAction(`Selected ${item.kind}: ${item.title}`);
          const data = item.data;
          if ("title" in data)
            setTracks((current) =>
              mergeUniqueTracks([...current, toComposerTrack(data)]),
            );
        }}
      />
      <output aria-live="polite" aria-label="Fixture action">
        {action}
      </output>
      <PlaylistComposerTrackListView
        tracks={tracks}
        t={t}
        onRemove={(track) =>
          setTracks((current) =>
            current.filter((item) => getTrackKey(item) !== getTrackKey(track)),
          )
        }
        onDragEnd={({ active, over }) => {
          if (over)
            setTracks((current) => {
              const next = [...current];
              const from = next.findIndex(
                  (track) => getTrackKey(track) === active.id,
                ),
                to = next.findIndex((track) => getTrackKey(track) === over.id);
              if (from < 0 || to < 0) return current;
              next.splice(to, 0, next.splice(from, 1)[0]!);
              return next;
            });
        }}
      />
    </main>
  );
}
export function CatalogSearchReview(props: {
  initialKinds?: CatalogSearchKind[];
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <Scene {...props} />
    </I18nextProvider>
  );
}
