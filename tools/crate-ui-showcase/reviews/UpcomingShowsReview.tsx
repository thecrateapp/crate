import { createRef, useRef, useState, type RefObject } from "react";
import { MemoryRouter } from "react-router";
import i18next from "i18next";
import ICU from "i18next-icu";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { ShowsPageView } from "../../../app/listen/src/pages/ShowsPageView";
import { buildShowsPageModel } from "../../../app/listen/src/pages/shows-page-model";
import {
  groupByMonth,
  formatMonthLabel,
  itemKey,
} from "../../../app/listen/src/components/upcoming/upcoming-list-model";
import type { UpcomingItem } from "../../../app/listen/src/components/upcoming/upcoming-types";
import { UpcomingMonthGroupView } from "../../../app/listen/src/components/upcoming/UpcomingMonthGroupView";
import { UpcomingShowCardView } from "../../../app/listen/src/components/upcoming/UpcomingShowCardView";
import { UpcomingReleaseRowView } from "../../../app/listen/src/components/upcoming/UpcomingReleaseRowView";
import { UpcomingEventArtwork } from "../../../app/listen/src/components/upcoming/UpcomingEventRowView";
import { ContextMenu } from "@crate/ui/domain/actions";
import { ExternalLink } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
const shows: UpcomingItem[] = [
  {
    id: 42,
    event_key: "show-42",
    type: "show",
    date: "2026-10-22",
    time: "20:45",
    artist: "Nocturnal Ensemble",
    artist_id: 7,
    artist_slug: "nocturnal-ensemble",
    title: "The Forum",
    subtitle: "London, United Kingdom",
    venue: "The Forum",
    address_line1: "9 Highgate Road",
    city: "London",
    postal_code: "NW5 1JY",
    country: "United Kingdom",
    cover_url: null,
    status: "onsale",
    is_upcoming: true,
    url: "https://tickets.example/show-42",
    lineup: ["Nocturnal Ensemble", "Costa Norte"],
    genre_profile: [
      { name: "post-punk", percent: 83, source: "enrichment" },
      { name: "drone", percent: 0 },
      { name: "ambient" },
    ],
    probable_setlist: [
      { title: "The Long Night", frequency: 0.83 },
      { title: "Into the Sea", frequency: 0 },
    ],
  },
  {
    id: 43,
    event_key: "show-43",
    type: "show",
    date: "2026-11-03",
    artist: "Costa Norte",
    artist_id: 8,
    artist_slug: "costa-norte",
    title: "Sala Radar",
    subtitle: "Madrid, Spain",
    venue: "Sala Radar",
    city: "Madrid",
    country: "Spain",
    cover_url: null,
    status: "onsale",
    is_upcoming: true,
    genres: ["ambient"],
  },
];
const releases: UpcomingItem[] = [
  {
    id: 80,
    event_key: "release-80",
    type: "release",
    date: "2026-10-24",
    artist: "Costa Norte",
    title: "Luz de octubre",
    subtitle: "Album",
    album_id: 80,
    album_slug: "luz-de-octubre",
    artist_slug: "costa-norte",
    cover_url: null,
    status: "announced",
    is_upcoming: true,
  },
  {
    id: 81,
    event_key: "release-81",
    type: "release",
    date: "2026-10-16",
    artist: "Nocturnal Ensemble",
    title: "The Last Light",
    subtitle: "Single",
    cover_url: null,
    status: "released",
    is_upcoming: false,
  },
];
type ReadState =
  | "ready"
  | "genre"
  | "sparse"
  | "no follows"
  | "empty"
  | "loading"
  | "error"
  | "not found"
  | "cached";

function UpcomingScene() {
  const { t } = useTranslation();
  const [read, setRead] = useState<ReadState>("ready");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "shows" | "releases">("all");
  const [expanded, setExpanded] = useState<string | null>("show-42");
  const [attending, setAttending] = useState(false);
  const [pending, setPending] = useState(false);
  const [long, setLong] = useState(false);
  const [artwork, setArtwork] = useState(true);
  const [event, setEvent] = useState("No action yet");
  const [menuId, setMenuId] = useState<string | null>(null);
  const triggerRefs = useRef(
    new Map<string, RefObject<HTMLButtonElement | null>>(),
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const sparse = read === "sparse";
  const currentShows = shows.map((item, index) => ({
    ...item,
    artist:
      long && index === 0
        ? "Nocturnal Ensemble and the Extraordinary Orchestra of the Very Long Night"
        : item.artist,
    user_attending: index === 0 && attending,
    ...(sparse
      ? {
          id: undefined,
          artist_id: undefined,
          url: undefined,
          genre_profile: undefined,
          probable_setlist: undefined,
          genres: ["ambient"],
        }
      : {}),
    ...(long && index === 0
      ? {
          probable_setlist: Array.from({ length: 12 }, (_, i) => ({
            title: `Night movement ${i + 1} · The Long Passage Through the Sea`,
            frequency: i === 0 ? 0 : 0.83,
          })),
        }
      : {}),
  }));
  const items = [...currentShows, ...releases];
  const empty = read === "empty" || read === "no follows";
  const data =
    read === "loading" || read === "error"
      ? null
      : {
          items: empty ? [] : items,
          summary: {
            followed_artists: read === "no follows" ? 0 : 2,
            show_count: empty ? 0 : 2,
            release_count: empty ? 0 : 2,
            attending_count: Number(attending),
            insight_count: 0,
          },
        };
  const isGenre = read === "genre" || read === "not found";
  const model = buildShowsPageModel({
    data,
    genreData: isGenre
      ? { name: "post-punk", slug: "post-punk", shows: currentShows }
      : null,
    genreSlug: isGenre ? "post-punk" : null,
    filter,
    focusShowId: null,
    search,
    today: "2026-10-20",
    upcomingLoading: read === "loading" || read === "cached",
    genreLoading: false,
  });
  const page = {
    ...model,
    filter,
    search,
    expandedId: expanded,
    setFilter,
    setSearch,
    setExpandedId: setExpanded,
    focusShowId: null,
    genreName: "post-punk",
    genreSlug: isGenre ? "post-punk" : null,
    t,
    hasData: data != null,
    error:
      read === "error" || read === "cached" || read === "not found"
        ? "Fixture read error"
        : null,
    status: read === "not found" ? 404 : null,
    refetch: () => {
      setEvent("Retry requested");
      setRead("ready");
    },
  };

  function renderEvent(item: UpcomingItem, feature = false) {
    const key = itemKey(item, 0);
    if (!triggerRefs.current.has(key))
      triggerRefs.current.set(key, createRef<HTMLButtonElement>());
    const triggerRef = triggerRefs.current.get(key)!;
    const actionMenu = {
      triggerRef,
      hasActions: true,
      open: menuId === key,
      onOpen: () => {
        setMenuId(key);
        setEvent(`Menu requested for ${item.artist}`);
      },
    };
    const menu = (
      <ContextMenu
        open={menuId === key}
        onClose={() => setMenuId(null)}
        menuRef={menuRef}
        position={{ x: 40, y: 200 }}
        items={[
          {
            key: "inspect",
            label: "Open artist",
            icon: ExternalLink,
            onSelect: () => {
              setEvent("Artist requested from menu");
              setMenuId(null);
            },
          },
        ]}
      />
    );
    const image = (
      <UpcomingEventArtwork
        kind={item.type}
        src={artwork && !sparse ? IMAGE_SAMPLES[0] : null}
      />
    );
    if (item.type === "release")
      return (
        <UpcomingReleaseRowView
          key={key}
          item={item}
          albumPath={item.album_id ? "/fixture/album" : null}
          artwork={image}
          actionMenu={actionMenu}
          menu={menu}
        />
      );
    return (
      <UpcomingShowCardView
        key={key}
        item={item}
        artistHref="/fixture/artist"
        variant={feature ? "feature" : "row"}
        expanded={expanded === key}
        artwork={image}
        actionMenu={actionMenu}
        menu={menu}
        attending={Boolean(item.user_attending)}
        savingAttendance={pending}
        playingSetlist={pending}
        onToggleAttendance={() => {
          setAttending((value) => !value);
          setEvent("Attendance requested");
        }}
        onPlaySetlist={() => setEvent("Play setlist requested")}
        onClose={() => {
          setExpanded(expanded === key ? null : key);
          setEvent("Expansion changed");
        }}
      />
    );
  }
  return (
    <main
      className="mx-auto grid max-w-6xl gap-8 p-4 sm:p-6"
      onClickCapture={(e) => {
        const link = (e.target as HTMLElement).closest("a");
        if (link && link.getAttribute("aria-disabled") !== "true") {
          e.preventDefault();
          setEvent("Navigation requested");
        }
      }}
    >
      <MonoLabel
        accent="1BC · Upcoming and shows"
        meta={["Actual Listen views · local fixture actions"]}
      />
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Read state">
          {(control) => (
            <Select value={read} onValueChange={(v) => setRead(v as ReadState)}>
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "ready",
                  "genre",
                  "sparse",
                  "no follows",
                  "empty",
                  "loading",
                  "error",
                  "not found",
                  "cached",
                ].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Artwork" layout="inline">
          <Checkbox
            checked={artwork}
            onCheckedChange={(v) => setArtwork(v === true)}
          />
        </FormField>
        <FormField label="Pending actions" layout="inline">
          <Checkbox
            checked={pending}
            onCheckedChange={(v) => setPending(v === true)}
          />
        </FormField>
        <Button variant="outline" onClick={() => setLong((value) => !value)}>
          {long ? "Use short content" : "Use long content"}
        </Button>
      </div>
      <ShowsPageView
        page={page}
        renderFeatured={(item) => renderEvent(item, true)}
        renderMonths={(monthItems) =>
          groupByMonth(monthItems).map(([month, entries]) => (
            <UpcomingMonthGroupView key={month} label={formatMonthLabel(month)}>
              {entries.map((item) => renderEvent(item))}
            </UpcomingMonthGroupView>
          ))
        }
      />
      <MonoLabel as="div" aria-label="Upcoming fixture event">
        {event}
      </MonoLabel>
    </main>
  );
}
export function UpcomingShowsReview() {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <UpcomingScene />
      </I18nextProvider>
    </MemoryRouter>
  );
}
