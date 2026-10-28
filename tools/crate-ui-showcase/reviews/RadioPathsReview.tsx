import { useMemo, useState } from "react";
import { MemoryRouter } from "react-router";
import i18next from "i18next";
import ICU from "i18next-icu";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { RadioPageView } from "../../../app/listen/src/pages/RadioPageView";
import { RadioSeedPanelView } from "../../../app/listen/src/pages/RadioSeedPanelView";
import { RadioStationRailView } from "../../../app/listen/src/pages/RadioStationRailView";
import { RadioStationCardView } from "../../../app/listen/src/components/radio/RadioStationCardView";
import { PathsPageView } from "../../../app/listen/src/pages/PathsPageView";
import { PathEndpointPanelView } from "../../../app/listen/src/pages/PathEndpointPanelView";
import { PathDetailHeaderView } from "../../../app/listen/src/pages/PathDetailHeaderView";
import { PathCoverJourneyView } from "../../../app/listen/src/components/paths/PathCoverJourneyView";
import { createCoverLoader } from "../../../app/listen/src/components/paths/path-cover-textures";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import type { SearchResult } from "../../../app/listen/src/pages/paths-model";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { Music2, Play } from "@crate/ui/icons";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
// Fixture artwork is local data URIs: no API, tickets or credentials.
const loadFixtureCover = createCoverLoader((url) => url, "omit");
const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
const seeds: SearchResult[] = [
  { type: "genre", value: "ambient", label: "Ambient" },
  {
    type: "artist",
    value: "coast",
    label: "Costa Norte",
    imageUrl: IMAGE_SAMPLES[0],
  },
  {
    type: "album",
    value: "night",
    label: "Luz de octubre",
    imageUrl: IMAGE_SAMPLES[1],
  },
  {
    type: "track",
    value: "dawn",
    label: "La marea — Costa Norte",
    imageUrl: IMAGE_SAMPLES[2],
  },
];
function Scene() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("detail"),
    [read, setRead] = useState("ready"),
    [pending, setPending] = useState(false),
    [artwork, setArtwork] = useState(true);
  const [length, setLength] = useState(20),
    [query, setQuery] = useState(""),
    [fromQuery, setFromQuery] = useState(""),
    [toQuery, setToQuery] = useState("");
  const [origin, setOrigin] = useState<SearchResult | null>(seeds[0]!),
    [destination, setDestination] = useState<SearchResult | null>(seeds[1]!);
  const [active, setActive] = useState(2),
    [playing, setPlaying] = useState(false),
    [confirm, setConfirm] = useState(false),
    [session, setSession] = useState<string | null>(null);
  const [event, setEvent] = useState("No action yet");
  const loading = read === "loading",
    error = read === "error",
    empty = read === "empty";
  const steps = useMemo(
    () =>
      Array.from({ length: empty ? 0 : length }, (_, index) => ({
        index,
        title: [
          "La marea",
          "Night signal",
          "A slow departure",
          "A distant shore",
        ][index % 4]!,
        artist: index % 2 ? "Nocturnal Ensemble" : "Costa Norte",
        coverUrl: artwork ? IMAGE_SAMPLES[index % 4] : undefined,
      })),
    [length, empty, artwork],
  );
  const start = (label: string) => {
    setSession(label);
    setEvent(`Radio requested: ${label}`);
  };
  const endpoints = (side: "origin" | "destination") => (
    <PathEndpointPanelView
      label={t(side === "origin" ? "paths.endpoint.from" : "paths.endpoint.to")}
      selected={side === "origin" ? origin : destination}
      onChange={() =>
        side === "origin" ? setOrigin(null) : setDestination(null)
      }
      query={side === "origin" ? fromQuery : toQuery}
      onQueryChange={side === "origin" ? setFromQuery : setToQuery}
      results={seeds.filter((s) =>
        s.label
          .toLowerCase()
          .includes((side === "origin" ? fromQuery : toQuery).toLowerCase()),
      )}
      searching={loading}
      error={error ? "Search unavailable" : undefined}
      onRetry={() => {
        setRead("ready");
        setEvent("Search retry requested");
      }}
      onSelect={(item) =>
        side === "origin" ? setOrigin(item) : setDestination(item)
      }
      disabled={pending}
    />
  );
  const rail = (kind: "artist" | "genre") => (
    <RadioStationRailView
      title={t(
        kind === "artist"
          ? "radio.artistStations.title"
          : "radio.genreStations.title",
      )}
      subtitle={t(
        kind === "artist"
          ? "radio.artistStations.subtitle"
          : "radio.genreStations.subtitle",
      )}
      count={empty || error || loading ? 0 : 3}
      loading={loading}
    >
      {!empty &&
        !error &&
        !loading &&
        Array.from({ length: 3 }, (_, i) => (
          <RadioStationCardView
            key={i}
            title={
              kind === "artist"
                ? ["Costa Norte", "Nocturnal Ensemble", "Viento Sur"][i]!
                : ["ambient", "jungle", "post-punk"][i]!
            }
            typeLabel={kind === "artist" ? "Artist Radio" : "Genre Radio"}
            artworkUrl={artwork ? IMAGE_SAMPLES[i] : null}
            playCount={i === 0 ? 0 : 84 - i * 10}
            disabled={pending}
            onPlay={() => start(`${kind} station ${i + 1}`)}
            openLabel={`Start ${kind} station ${i + 1}`}
          />
        ))}
    </RadioStationRailView>
  );
  return (
    <main className="mx-auto grid max-w-6xl min-w-0 gap-7 p-4 sm:p-6">
      <MonoLabel
        accent="1BC · Radio and Paths"
        meta={["Actual Listen views · local fixture actions"]}
      />
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Read state">
          {(control) => (
            <Select value={read} onValueChange={setRead}>
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ready", "loading", "empty", "error"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Path tracks">
          {(control) => (
            <Select
              value={String(length)}
              onValueChange={(v) => {
                setLength(Number(v));
                setActive(0);
              }}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 5, 20, 50].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField layout="inline" label="Pending actions">
          <Checkbox
            checked={pending}
            onCheckedChange={(v) => setPending(v === true)}
          />
        </FormField>
        <FormField layout="inline" label="Artwork">
          <Checkbox
            checked={artwork}
            onCheckedChange={(v) => setArtwork(v === true)}
          />
        </FormField>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Review view">
          <TabsTrigger value="radio">Radio</TabsTrigger>
          <TabsTrigger value="builder">Paths</TabsTrigger>
          <TabsTrigger value="detail">Path detail</TabsTrigger>
        </TabsList>
        <TabsContent value="radio">
          <RadioPageView
            radio={{
              starting: pending,
              discoveryAvailable: !empty,
              startDiscovery: () => start("Discovery"),
              activeSession: session,
              activeMode: session ? "seeded" : null,
              seedLabel: session ?? "",
              stationsError: error ? "fixture error" : null,
              retryStations: () => {
                setRead("ready");
                setEvent("Station retry requested");
              },
            }}
            seed={
              <RadioSeedPanelView
                query={query}
                onQueryChange={setQuery}
                searching={loading}
                starting={pending}
                error={error ? "Search unavailable" : undefined}
                onRetry={() => setRead("ready")}
                results={
                  empty
                    ? []
                    : seeds.filter(
                        (s) =>
                          s.type !== "track" &&
                          s.label.toLowerCase().includes(query.toLowerCase()),
                      )
                }
                onStartSeeded={(seed) => start(seed.label)}
              />
            }
            artistStations={rail("artist")}
            genreStations={rail("genre")}
          />
        </TabsContent>
        <TabsContent value="builder">
          <PathsPageView
            originPanel={endpoints("origin")}
            destinationPanel={endpoints("destination")}
            steps={length}
            onStepsChange={setLength}
            creating={pending}
            canCreate={!!origin && !!destination && !pending}
            onCreate={() => {
              setTab("detail");
              setEvent("Compute path requested");
            }}
            loading={loading}
            error={error ? "fixture error" : null}
            pathCount={loading || error ? null : empty ? 0 : 1}
            onRetry={() => {
              setRead("ready");
              setEvent("Paths retry requested");
            }}
          >
            <EntityRow
              title="Ambient → Costa Norte"
              subtitle={<MonoLabel as="span">20 tracks</MonoLabel>}
              meta={<MonoLabel as="span">Ambient → Costa Norte</MonoLabel>}
              onOpen={() => setTab("detail")}
              openLabel="Open Ambient to Costa Norte"
              trailing={
                <ActionGroup>
                  <ActionButton
                    label="Play saved path"
                    onClick={() => {
                      setTab("detail");
                      setPlaying(true);
                      setActive(0);
                      setEvent("Play path requested");
                    }}
                  >
                    <Play aria-hidden="true" />
                  </ActionButton>
                </ActionGroup>
              }
            />
          </PathsPageView>
        </TabsContent>
        <TabsContent value="detail">
          <div className="grid min-w-0 gap-6 pt-6">
            <PathDetailHeaderView
              name="Ambient → Costa Norte"
              origin="Ambient"
              destination="Costa Norte"
              count={steps.length}
              regenerating={pending}
              onPlay={() => {
                setPlaying(true);
                setActive(0);
                setEvent("Play path requested");
              }}
              onRegenerate={() => setEvent("Regenerate requested")}
              onDelete={() => setConfirm(true)}
            />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                disabled={!steps.length}
                onClick={() => {
                  setActive((v) => (v + 1) % steps.length);
                  setPlaying(true);
                  setEvent("Simulated next track");
                }}
              >
                Simulate next track
              </Button>
              <Button variant="ghost" onClick={() => setPlaying((v) => !v)}>
                {playing ? "Pause simulation" : "Resume simulation"}
              </Button>
            </div>
            <PathCoverJourneyView
              steps={steps}
              origin="Ambient"
              destination="Costa Norte"
              activeStep={active}
              currentTrackKey={
                steps[active] ? `fixture-track-${active}` : undefined
              }
              playing={playing}
              loadCover={loadFixtureCover}
              onPlay={(index) => {
                setActive(index);
                setPlaying(true);
                setEvent(`Play from step ${index + 1}`);
              }}
            />
            <div role="table" aria-label="Path tracks">
              {steps.map((step, index) => (
                <TrackRowView
                  key={index}
                  aria-label={step.title}
                  active={active === index}
                  onClick={() => {
                    setActive(index);
                    setPlaying(true);
                    setEvent(`Play from step ${index + 1}`);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.target === e.currentTarget &&
                      ["Enter", " "].includes(e.key)
                    ) {
                      e.preventDefault();
                      setActive(index);
                      setPlaying(true);
                      setEvent(`Play from step ${index + 1}`);
                    }
                  }}
                >
                  <TrackRowContent
                    rank={index + 1}
                    title={step.title}
                    quality={{
                      label: "FLAC 16/44.1",
                      detail: "16-bit / 44.1 kHz",
                      tier: "lossless",
                    }}
                    tempo={String(90 + index)}
                    musicalKey="7A"
                    duration="3:30"
                    leading={
                      <MediaCover
                        src={step.coverUrl}
                        alt=""
                        className="size-12 shrink-0"
                        fallbackIcon={Music2}
                      />
                    }
                    details={
                      <p className="text-caption text-text-muted">
                        {step.artist}
                      </p>
                    }
                    actions={null}
                  />
                </TrackRowView>
              ))}
            </div>
            <ConfirmDialog
              open={confirm}
              onOpenChange={setConfirm}
              title="Delete this path?"
              description="Local fixture only."
              confirmLabel="Delete"
              cancelLabel="Cancel"
              closeLabel="Close"
              ariaLabel="Delete path"
              backdropLabel="Close"
              tone="danger"
              onConfirm={() => {
                setConfirm(false);
                setEvent("Delete path requested");
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
      <MonoLabel as="div" aria-label="Radio Paths fixture event">
        {event}
      </MonoLabel>
    </main>
  );
}
export function RadioPathsReview() {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <Scene />
      </I18nextProvider>
    </MemoryRouter>
  );
}
