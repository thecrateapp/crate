import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { CRATE_ICON_SIZE, Heart, MoreHorizontal } from "@crate/ui/icons";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { HomeShowPrepSection } from "../../../app/listen/src/components/home/HomeShowPrep";
import { HomeUpcomingSectionView } from "../../../app/listen/src/components/home/HomeUpcomingSectionView";
import { HomeUpcomingFeatureView } from "../../../app/listen/src/components/home/HomeUpcomingFeatureView";
import { HomeReplaySectionView } from "../../../app/listen/src/components/home/HomeReplaySectionView";
import { StatsMiniTape } from "../../../app/listen/src/components/stats/StatsMiniTape";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import { TrackRowPlaybackControl } from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import { SidebarNavigationView } from "../../../app/listen/src/components/layout/ListenNavigation";
import {
  listenNavigationItems,
  collectionNavigationItems,
} from "../../../app/listen/src/components/layout/listen-navigation-model";
import { getQualityBadge } from "../../../app/listen/src/components/player/bar/player-bar-utils";
import type { HomeUpcomingItem } from "../../../app/listen/src/components/home/home-types";
import type { StatsTape } from "../../../app/listen/src/components/stats/stats-types";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import "../../../app/listen/src/components/layout/listen-shell.css";

const ITEMS: HomeUpcomingItem[] = [
  {
    type: "show",
    artist: "Caspian",
    artist_slug: "caspian",
    title: "Sala Apolo",
    venue: "Sala Apolo",
    subtitle: "Barcelona, Spain",
    date: "2030-11-12",
    is_upcoming: true,
    probable_setlist: [{ title: "Hiraeth" }],
  },
  {
    type: "release",
    artist: "Repion",
    title: "A new horizon",
    subtitle: "Album",
    date: "2030-11-20",
    is_upcoming: true,
  },
  {
    type: "show",
    artist: "A very long artist name that must wrap within the panel",
    title: "The Independent",
    subtitle: "San Francisco, United States",
    date: "2030-12-04",
    is_upcoming: true,
    user_attending: true,
  },
];
const TAPE: StatsTape = {
  granularity: "day",
  start: "2026-10-01",
  end: "2026-10-30",
  points: Array.from({ length: 30 }, (_, index) => ({
    bucket: `2026-10-${String(index + 1).padStart(2, "0")}`,
    minutes: [22, 5, 44, 0, 64, 13, 37][index % 7]!,
    plays: 4,
  })),
  mood: [],
  peaks: [],
  months: [],
};

function FixtureTrack({
  index,
  compact = false,
  missing = false,
  onAction,
}: {
  index: number;
  compact?: boolean;
  missing?: boolean;
  onAction: (message: string) => void;
}) {
  const title = [
    "Hiraeth",
    "Far Country",
    "A very long track title with metadata",
    "Missing metadata",
  ][index]!;
  return (
    <TrackRowView
      aria-label={title}
      density={compact ? "compact" : "default"}
      onClick={() => onAction(`Play ${title}`)}
    >
      <TrackRowContent
        leading={
          <TrackRowPlaybackControl
            disabled={false}
            index={index + 1}
            isActive={false}
            isPlaying={false}
            label={`Play ${title}`}
            artwork={
              <MediaCover
                src={IMAGE_SAMPLES[index % 4]}
                alt=""
                className="size-12"
              />
            }
            onClick={(event) => {
              event.stopPropagation();
              onAction(`Play ${title}`);
            }}
          />
        }
        title={title}
        details={<span className="text-xs text-text-muted">Caspian</span>}
        quality={
          missing
            ? null
            : getQualityBadge({
                format: index === 2 ? "mp3" : "flac",
                sampleRate: index === 1 ? 96000 : 44100,
                bitDepth: index === 1 ? 24 : 16,
                bitrate: 320,
              })
        }
        tempo={missing ? null : String([112, 76, 99][index % 3])}
        musicalKey={missing ? null : "8B"}
        duration={missing ? undefined : ["3:56", "6:03", "9:15"][index % 3]}
        like={
          index === 1 ? null : (
            <ActionGroup label="Track like">
              <ActionButton
                label={`Like ${title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onAction(`Like ${title}`);
                }}
              >
                <Heart size={CRATE_ICON_SIZE.md} />
              </ActionButton>
            </ActionGroup>
          )
        }
        actions={
          <ActionGroup label="Track actions">
            <ActionButton
              label={`More actions for ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                onAction(`Menu ${title}`);
              }}
            >
              <MoreHorizontal size={CRATE_ICON_SIZE.md} />
            </ActionButton>
          </ActionGroup>
        }
      />
    </TrackRowView>
  );
}

function HomeSignalsExamples() {
  const { t } = useTranslation();
  const location = useLocation();
  const [scenario, setScenario] = useState("ready");
  const [expanded, setExpanded] = useState(true);
  const [event, setEvent] = useState("No action yet");
  const empty = scenario === "empty" || scenario === "no-signals";
  const items = empty
    ? []
    : scenario === "single"
      ? ITEMS.slice(0, 1)
      : scenario === "released"
        ? [{ ...ITEMS[1]!, date: "2026-01-12", is_upcoming: false }, ITEMS[0]!]
        : ITEMS;
  const item = items[0];
  return (
    <main className="mx-auto grid max-w-7xl gap-8 p-4 sm:p-8">
      <PageHeader
        eyebrow="1BE · Review"
        title="Home signals and stable track rows"
        subtitle="Actual Home views and sidebar. Local fixture actions; no requests, audio or saved preferences."
      />
      <FormField label="Scenario">
        {(control) => (
          <Select value={scenario} onValueChange={setScenario}>
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["ready", "single", "empty", "no-signals", "released"].map(
                (s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        )}
      </FormField>
      <FormField kind="group" label="Sidebar · primary and Collection links">
        {(group) => (
          <div
            {...group}
            role="group"
            className="max-w-full rounded-panel border border-border-quiet py-3"
            style={{ width: expanded ? 240 : 64 }}
          >
            <SidebarNavigationView
              expanded={expanded}
              items={listenNavigationItems(t, false)}
              sections={collectionNavigationItems(t, false, location)}
              collectionLabel={t("nav.collection")}
              expandLabel="Expand sidebar"
              collectionActive={location.pathname === "/library"}
              onToggleExpanded={() => setExpanded(true)}
            />
            <ActionGroup label="Sidebar state">
              <ActionButton
                label={expanded ? "Collapse sidebar" : "Expand sidebar"}
                onClick={() => setExpanded(!expanded)}
              >
                <MoreHorizontal size={CRATE_ICON_SIZE.md} />
              </ActionButton>
            </ActionGroup>
          </div>
        )}
      </FormField>
      <HomeUpcomingSectionView
        previewItems={items}
        summary={{
          followed_artists: scenario === "empty" ? 0 : 12,
          show_count: 2,
          release_count: 1,
          attending_count: 1,
          insight_count: 0,
        }}
        onOpenUpcoming={() => setEvent("Open Radar")}
        feature={
          item ? (
            <HomeUpcomingFeatureView
              item={item}
              date={scenario === "released" ? "January 12" : "November 12"}
              releasePath="/artists/repion/a-new-horizon"
              artistPath="/artists/caspian"
              onOpenUpcoming={() => setEvent("Open Radar")}
              onPlaySetlist={() => setEvent("Play setlist")}
              artwork={
                <MediaCover
                  src={IMAGE_SAMPLES[0]}
                  alt=""
                  className="size-full"
                />
              }
            />
          ) : null
        }
      />
      {!empty ? (
        <HomeShowPrepSection
          insights={[
            {
              type: "show_prep",
              show_id: 1,
              artist: "Caspian",
              date: "2030-11-12",
              title: "Caspian at Sala Apolo",
              subtitle: "Barcelona, Spain",
              message: "Revisit the songs before the show.",
              has_setlist: true,
              weight: "high",
            },
          ]}
          onOpenUpcoming={() => setEvent("Open Radar")}
          onPlaySetlist={() => setEvent("Play show-prep setlist")}
          onSaveReminder={() => setEvent("Save show reminder")}
        />
      ) : null}
      {!empty ? (
        <HomeReplaySectionView
          replay={{
            window: "month:2026-10",
            title: "Replay October 2026",
            subtitle: "",
            track_count: 18,
            minutes_listened: 657,
            items: [],
          }}
          signal={{
            days: 30,
            minutes: 657,
            plays: 276,
            artists: 54,
            tape: TAPE,
          }}
          signalVisualization={<StatsMiniTape tape={TAPE} />}
          onOpenStats={() => setEvent("Open Crate DNA")}
          onPlayReplay={() => setEvent("Play month replay")}
          tracks={[0, 1, 2].map((index) => (
            <FixtureTrack
              key={index}
              index={index}
              compact
              onAction={setEvent}
            />
          ))}
        />
      ) : null}
      <FormField kind="group" label="Stable metadata · Caspian reference">
        {(group) => (
          <div {...group} role="group" data-testid="stable-track-metadata">
            {[0, 1, 2, 3].map((index) => (
              <FixtureTrack
                key={index}
                index={index}
                compact={index === 1}
                missing={index === 3}
                onAction={setEvent}
              />
            ))}
          </div>
        )}
      </FormField>
      <output aria-live="polite" aria-label="Fixture action">
        {event}
      </output>
    </main>
  );
}
export function HomeSignalsReview() {
  return (
    <SettingsFixtureProvider>
      <MemoryRouter initialEntries={["/library?tab=albums"]}>
        <HomeSignalsExamples />
      </MemoryRouter>
    </SettingsFixtureProvider>
  );
}
