import { useState, type ReactNode } from "react";
import { PageHeader } from "@crate/ui/domain/navigation";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { OfflineLibraryView } from "../../../app/listen/src/pages/OfflineLibraryView";
import { OfflineSettingsView } from "../../../app/listen/src/components/settings/OfflineSettingsView";
import { OfflineDownloadsView } from "../../../app/listen/src/components/settings/OfflineDownloadsView";
import { PlayerSeekBar } from "../../../app/listen/src/components/player/bar/PlayerSeekBar";
import { TrackRowPlaybackProgressView } from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import type { OfflineItemRecord } from "../../../app/listen/src/lib/offline-model";
import { formatBytes } from "../../../app/listen/src/lib/utils";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label}>
      {(field) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...field}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField kind="group" label={label}>
      {(group) => (
        <div {...group} role="group" className="min-w-0">
          {children}
        </div>
      )}
    </FormField>
  );
}
export function OfflineLibraryExample() {
  const [scenario, setScenario] = useState("populated"),
    [selected, setSelected] = useState<number | null>(null),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0);
  const [event, setEvent] = useState("No playback action yet");
  const tracks = [
    {
      id: "offline:one",
      albumCover: IMAGE_SAMPLES[0],
      title: "Marea",
      artist: "Costa Norte",
      duration: 195,
      format: "flac",
      bitDepth: 16,
      sampleRate: 44100,
    },
    {
      id: "offline:two",
      albumCover: IMAGE_SAMPLES[0],
      title: "Horizonte",
      artist: "Costa Norte",
      duration: 120,
      format: "mp3",
      bitrate: 320,
    },
    {
      id: "offline:three",
      title: "A saved song without quality metadata",
      artist: "Mixed Case Artist",
    },
  ];
  const visible =
    scenario === "empty"
      ? []
      : scenario === "partial"
        ? tracks.slice(0, 1)
        : tracks;
  const current = selected == null ? null : (visible[selected] ?? null);
  return (
    <div className="grid min-w-0 gap-6">
      <Choice
        label="Offline library state"
        value={scenario}
        options={["populated", "partial", "empty", "buffering"]}
        onChange={(value) => {
          setScenario(value);
          setSelected(null);
          setPlaying(false);
          setTime(0);
        }}
      />
      <Sample label="Actual offline library">
        <OfflineLibraryView
          groups={
            visible.length
              ? [
                  {
                    key: "album:sample",
                    title: "Luz de octubre",
                    tracks: visible,
                  },
                ]
              : []
          }
          currentTrack={current}
          isPlaying={playing}
          isBuffering={scenario === "buffering"}
          onPlay={(_group, track) => {
            setSelected(track);
            setPlaying(true);
            setTime(0);
            setEvent("Track played locally");
          }}
          onPause={() => {
            setPlaying(false);
            setEvent("Paused locally");
          }}
          onResume={() => {
            setPlaying(true);
            setEvent("Resumed locally");
          }}
          onPrevious={() => {
            setSelected(0);
            setEvent("Previous requested locally");
          }}
          onNext={() => {
            setSelected(Math.min(visible.length - 1, 1));
            setEvent("Next requested locally");
          }}
          activeGlyph={
            <TrackRowPlaybackProgressView
              currentTime={time}
              duration={current?.duration ?? 0}
              isPlaying={playing}
            />
          }
          progress={
            <PlayerSeekBar
              currentTime={time}
              duration={current?.duration ?? 0}
              onSeek={setTime}
              disabled={!current || scenario === "buffering"}
              thin
              variant="glow"
              showTimes
            />
          }
        />
      </Sample>
      <output aria-label="Offline playback event">{event}</output>
    </div>
  );
}
function fixtureItem(
  index: number,
  state: OfflineItemRecord["state"],
): OfflineItemRecord {
  return {
    key: `album:${index}`,
    kind: index === 2 ? "playlist" : "album",
    entityId: String(index),
    title:
      [
        "Luz de octubre",
        "An album with an unusually long title that remains readable on a narrow screen",
        "Evening playlist",
        "Waiting for download",
        "Updating a saved album",
      ][index] ?? "Saved album",
    state,
    trackCount: 10,
    readyTrackCount: state === "ready" ? 10 : 6,
    artwork:
      index === 2
        ? undefined
        : { cover_url: IMAGE_SAMPLES[index % IMAGE_SAMPLES.length] },
    totalBytes: 128 * 1024 * 1024,
    tracks: [],
  };
}
export function OfflineStorageExample() {
  const [mode, setMode] = useState("mixed"),
    [knownQuota, setKnownQuota] = useState(true),
    [event, setEvent] = useState("No storage action yet");
  const empty = mode === "empty" || mode === "unsupported";
  const items = empty
    ? []
    : mode === "unknown total"
      ? [
          {
            ...fixtureItem(0, "queued"),
            trackCount: 0,
            readyTrackCount: 0,
            totalBytes: 0,
            contentVersion: null,
          },
        ]
      : [
          fixtureItem(0, "ready"),
          fixtureItem(1, "downloading"),
          fixtureItem(2, "error"),
          fixtureItem(3, "queued"),
          fixtureItem(4, "syncing"),
        ];
  const summary = {
    itemCount: items.length,
    readyItemCount: items.filter((item) => item.state === "ready").length,
    errorItemCount: items.filter((item) => item.state === "error").length,
    trackCount: items.reduce((sum, item) => sum + item.trackCount, 0),
    readyTrackCount: items.reduce((sum, item) => sum + item.readyTrackCount, 0),
    totalBytes: items.reduce((sum, item) => sum + (item.totalBytes ?? 0), 0),
  };
  return (
    <div className="grid min-w-0 gap-6 @container">
      <Choice
        label="Offline storage state"
        value={mode}
        options={[
          "mixed",
          "unknown total",
          "empty",
          "unsupported",
          "read-only",
          "syncing",
        ]}
        onChange={setMode}
      />
      <FormField layout="inline" label="Known browser quota">
        <Checkbox
          checked={knownQuota}
          onCheckedChange={(value) => setKnownQuota(value === true)}
        />
      </FormField>
      <Sample label="Actual offline management">
        <OfflineSettingsView
          supported={mode !== "unsupported"}
          readOnly={mode === "read-only"}
          syncing={mode === "syncing"}
          summary={summary}
          storageQuota={knownQuota ? 1024 * 1024 * 1024 : null}
          bytesText={formatBytes(summary.totalBytes)}
          quotaText={knownQuota ? "1 GB" : null}
          downloads={<OfflineDownloadsView items={items} />}
          onSync={() => setEvent("Sync requested locally")}
          onClear={() => setEvent("Local copies removal requested")}
        />
      </Sample>
      <output aria-label="Offline storage event">{event}</output>
    </div>
  );
}
export function OfflineReview({
  initialTab = "library",
  locale = "en",
}: {
  initialTab?: "library" | "storage";
  locale?: "en" | "eu";
}) {
  const [tab, setTab] = useState(initialTab);
  return (
    <SettingsFixtureProvider locale={locale}>
      <div className="mx-auto grid w-full max-w-7xl gap-8 p-4 sm:p-8">
        <PageHeader
          eyebrow="Checkpoint 1BD"
          title="Offline listening"
          subtitle="Actual library and download views. All actions stay local to this review."
          size="md"
        />
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as typeof tab)}
        >
          <TabsList aria-label="Offline review sections">
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="storage">Downloads and storage</TabsTrigger>
          </TabsList>
          <TabsContent value="library">
            <OfflineLibraryExample />
          </TabsContent>
          <TabsContent value="storage">
            <OfflineStorageExample />
          </TabsContent>
        </Tabs>
      </div>
    </SettingsFixtureProvider>
  );
}
