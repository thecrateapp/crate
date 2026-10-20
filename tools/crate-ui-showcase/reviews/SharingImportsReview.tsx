import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Camera,
  LayoutGrid,
  ListOrdered,
  Podium,
  Play,
  Disc,
} from "@crate/ui/icons";
import { ItemActionMenu } from "@crate/ui/domain/actions/ItemActionMenu";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { MediaGrid } from "@crate/ui/domain/lists/MediaGrid";
import { EmptyState } from "@crate/ui/domain/states";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crate/ui/shadcn/tabs";
import { ShareSheetView } from "../../../app/listen/src/components/share/ShareSheetView";
import { BandcampPageView } from "../../../app/listen/src/pages/BandcampPageView";
import { BandcampItemView } from "../../../app/listen/src/components/bandcamp/BandcampItemView";
import { BandcampItemActionsView } from "../../../app/listen/src/components/bandcamp/BandcampItemActionsView";
import { buildBandcampActions } from "../../../app/listen/src/components/actions/bandcamp-actions";
import { UploadView } from "../../../app/listen/src/pages/UploadView";
import {
  RemoteImportView,
  type RemoteImportStatus,
} from "../../../app/listen/src/components/imports/RemoteImportView";
import { LibraryContributionCard } from "../../../app/listen/src/components/library/LibraryContributionCard";
import { buildContributionActions } from "../../../app/listen/src/components/actions/contribution-actions";
import { ContributionWithdrawDialog } from "../../../app/listen/src/components/library/ContributionWithdrawDialog";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

export type SharingImportsTab =
  | "sharing"
  | "bandcamp"
  | "upload"
  | "remote"
  | "contributions";
const tabs: SharingImportsTab[] = [
  "sharing",
  "bandcamp",
  "upload",
  "remote",
  "contributions",
];
function FixtureStateSelect({
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
      {(props) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...props}>
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
function SampleGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <FormField label={label} kind="group">
      {(props) => (
        <div {...props} role="group" className="min-w-0">
          {children}
        </div>
      )}
    </FormField>
  );
}
export function SharingImportsReview({
  initialTab = "sharing",
}: {
  initialTab?: SharingImportsTab;
}) {
  const [tab, setTab] = useState<SharingImportsTab>(initialTab);
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid max-w-6xl gap-8 p-4 sm:p-6">
        <PageHeader
          title="Sharing and imports"
          eyebrow="1BD · Review"
          subtitle="Actual Listen views and shared components. Static data and local fixture callbacks; no uploads, clipboard writes, external sharing, API calls or stored preferences."
        />
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as SharingImportsTab)}
        >
          <TabsList aria-label="Sharing and imports examples">
            {tabs.map((item) => (
              <TabsTrigger key={item} value={item}>
                {item}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="sharing">
            <SharingExample />
          </TabsContent>
          <TabsContent value="bandcamp">
            <BandcampExample />
          </TabsContent>
          <TabsContent value="upload">
            <UploadExample />
          </TabsContent>
          <TabsContent value="remote">
            <RemoteImportExample />
          </TabsContent>
          <TabsContent value="contributions">
            <ContributionsExample />
          </TabsContent>
        </Tabs>
      </main>
    </SettingsFixtureProvider>
  );
}

export function SharingExample() {
  const [open, setOpen] = useState(false),
    [style, setStyle] = useState(false),
    [mode, setMode] = useState("album");
  const [event, setEvent] = useState("No sharing action yet");
  const busy = mode === "busy";
  useEffect(() => {
    if (!open || !busy) return;
    const timer = window.setTimeout(() => {
      setMode("album");
      setEvent("Fixture image generation finished locally");
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [open, busy]);
  const finish = (text: string) => {
    setEvent(text);
    setOpen(false);
  };
  return (
    <div className="grid min-w-0 gap-6">
      <FixtureStateSelect
        label="Sharing state"
        value={mode}
        options={["album", "crate", "digging", "unavailable", "busy", "long"]}
        onChange={setMode}
      />
      <Button
        onClick={() => {
          setStyle(false);
          setOpen(true);
        }}
      >
        Open sharing
      </Button>
      <output aria-label="Sharing fixture event">{event}</output>
      {open ? (
        <ShareSheetView
          context={
            mode === "digging"
              ? "Share Digging"
              : mode === "crate"
                ? "Share Crate"
                : "Share album"
          }
          title={
            mode === "long"
              ? "An extraordinarily long record title with enough words to wrap on a narrow screen"
              : "Night Music"
          }
          subtitle="Mixed Case Artist"
          preview={
            <MediaCover
              src={IMAGE_SAMPLES[0]}
              className="size-16 shrink-0"
              alt=""
            />
          }
          displayUrl="listen.example/share/album/night-music"
          diggingOnly={mode === "digging"}
          choosingStoryStyle={style}
          storyChoices={[
            {
              id: "bento",
              title: "Wall",
              subtitle: "All your records",
              icon: LayoutGrid,
            },
            {
              id: "podium",
              title: "Podium",
              subtitle: "Your top three",
              icon: Podium,
            },
            {
              id: "chart",
              title: "Chart",
              subtitle: "An ordered selection",
              icon: ListOrdered,
            },
          ]}
          busyAction={busy ? "square" : null}
          storyDisabled={mode === "unavailable" || busy}
          storySubtitle={
            mode === "unavailable"
              ? "Instagram is unavailable on this device"
              : "A story image for sharing"
          }
          onClose={() => setOpen(false)}
          onBack={() => setStyle(false)}
          onStory={() =>
            mode === "crate"
              ? setStyle(true)
              : finish("Story requested locally")
          }
          onSquare={() => finish("Square image requested locally")}
          onChooseStyle={(index) =>
            finish(`Story style ${index + 1} requested locally`)
          }
          onWhatsApp={() => finish("WhatsApp requested locally")}
          onTelegram={() => finish("Telegram requested locally")}
          onCopy={() => finish("Link copied locally")}
        />
      ) : null}
    </div>
  );
}

function FixtureBandcampItem({
  variant,
  imported,
  canImport,
  onAction,
  long,
  sampleIndex = 0,
}: {
  variant: "row" | "tile";
  imported?: boolean;
  canImport: boolean;
  onAction: (text: string) => void;
  long: boolean;
  sampleIndex?: number;
}) {
  const { t } = useTranslation();
  const records = [
    { title: "Night Music", artist: "Mixed Case Artist" },
    { title: "The Baneful Choir", artist: "Teitanblood" },
    { title: "Hate Springs Eternal", artist: "Hounds of Hate" },
    { title: "Maktbehov", artist: "GOD MOTHER" },
  ] as const;
  const { artist, title: sampleTitle } = records[sampleIndex] ?? records[0];
  const title = long
    ? "Averylongunbrokenrecordnamethatstillwrapswithoutstretchingthelayout"
    : sampleTitle;
  const actionMenu = {
    getActions: () =>
      buildBandcampActions(
        {
          canImport,
          itemUrl: "https://example.bandcamp.com/album/night-music",
          onImport: () => onAction("Import requested locally"),
          onOpen: () => onAction("Open on Bandcamp requested locally"),
        },
        t,
      ),
    hasActions: true,
    header: {
      type: "media" as const,
      title,
      subtitle: artist,
      imageUrl: IMAGE_SAMPLES[sampleIndex],
      imageAlt: title,
    },
  };
  return (
    <BandcampItemView
      variant={variant}
      title={title}
      artist={artist}
      artwork={
        <MediaCover
          src={IMAGE_SAMPLES[sampleIndex]}
          alt=""
          className={
            variant === "row" ? "size-14 shrink-0" : "aspect-square w-full"
          }
        />
      }
      importedLabel={imported ? "In Crate" : undefined}
      actions={
        variant === "row" ? (
          <BandcampItemActionsView
            title={title}
            canImport={canImport}
            importing={false}
            importDisabled={false}
            hasUrl
            onImport={() => onAction("Import requested locally")}
            onOpen={() => onAction("Open on Bandcamp requested locally")}
          />
        ) : undefined
      }
      actionMenu={actionMenu}
      menuLabel={`More actions: ${title}`}
      onOpen={
        variant === "tile"
          ? () => onAction("Open on Bandcamp requested locally")
          : undefined
      }
    />
  );
}
export function BandcampExample() {
  const [state, setState] = useState("ready"),
    [event, setEvent] = useState("No Bandcamp action yet");
  const empty = state === "empty";
  const item = (kind: "owned" | "radar" | "wishlist", sampleIndex = 0) =>
    empty ? (
      <EmptyState message="No items in this collection" />
    ) : (
      <FixtureBandcampItem
        key={`${kind}-${sampleIndex}`}
        variant={kind === "radar" ? "row" : "tile"}
        imported={kind === "owned" && sampleIndex === 3}
        canImport={kind === "owned" && sampleIndex !== 3}
        onAction={setEvent}
        long={state === "long"}
        sampleIndex={sampleIndex}
      />
    );
  return (
    <div className="grid min-w-0 gap-6">
      <FixtureStateSelect
        label="Bandcamp read state"
        value={state}
        options={["ready", "loading", "error", "empty", "disconnected", "long"]}
        onChange={setState}
      />
      <SampleGroup label="Actual Bandcamp page">
        <BandcampPageView
          readState={state === "loading" || state === "error" ? state : "ready"}
          connected={state !== "disconnected"}
          profileName="Jane McKay"
          busyAction={null}
          totals={{
            owned: empty ? 0 : 12,
            wishlist: empty ? 0 : 4,
            radar: empty ? 0 : 8,
          }}
          radar={
            <div className="space-y-3">
              {empty
                ? item("radar")
                : [0, 1, 2, 3].map((index) => item("radar", index))}
            </div>
          }
          owned={
            <MediaGrid density="wide">
              {empty
                ? item("owned")
                : [0, 1, 2, 3].map((index) => item("owned", index))}
            </MediaGrid>
          }
          wishlist={
            <MediaGrid density="wide">
              {empty
                ? item("wishlist")
                : [0, 1, 2, 3].map((index) => item("wishlist", index))}
            </MediaGrid>
          }
          onSync={() => setEvent("Sync requested locally")}
          onRefreshRadar={() => setEvent("Radar refresh requested locally")}
          onRetry={() => {
            setEvent("Bandcamp retry requested locally");
            setState("ready");
          }}
        />
      </SampleGroup>
      <output aria-label="Bandcamp fixture event">{event}</output>
    </div>
  );
}
export function UploadExample() {
  const [state, setState] = useState("empty"),
    [files, setFiles] = useState<File[]>([]),
    [event, setEvent] = useState("No upload yet");
  const sample = () => [
    new File([new Uint8Array(1000)], "Evening Music.flac"),
    new File([new Uint8Array(2000)], "Whole Album.zip"),
  ];
  const choose = (value: string) => {
    setState(value);
    setFiles(value === "empty" || value === "queued" ? [] : sample());
  };
  return (
    <div className="grid min-w-0 gap-6">
      <FixtureStateSelect
        label="Upload state"
        value={state}
        options={[
          "empty",
          "files",
          "unknown progress",
          "confirmed progress",
          "queued",
        ]}
        onChange={choose}
      />
      <SampleGroup label="Actual upload form">
        <UploadView
          files={files}
          submitting={state.includes("progress")}
          lastUpload={
            state === "queued"
              ? {
                  task_id: "fixture-task",
                  upload_id: "fixture-upload",
                  file_count: 2,
                  total_bytes: 3000,
                }
              : null
          }
          uploadProgress={
            state === "confirmed progress" ? { done: 1, total: 3 } : null
          }
          fileProgress={
            state === "confirmed progress"
              ? { 0: { fileIndex: 0, loadedBytes: 500, totalBytes: 1000 } }
              : {}
          }
          totalBytes={files.reduce((sum, file) => sum + file.size, 0)}
          onFilesChange={(chosen) => {
            setFiles(chosen);
            setState("files");
          }}
          onClear={() => choose("empty")}
          onSubmit={() => {
            setEvent("Upload queued locally");
            choose("queued");
          }}
        />
      </SampleGroup>
      <output aria-label="Upload fixture event">{event}</output>
    </div>
  );
}
const remoteStates: RemoteImportStatus[] = [
  "idle",
  "requesting",
  "requested",
  "awaiting_approval",
  "approved",
  "reserving",
  "downloading",
  "verifying",
  "importing",
  "completed",
  "cancelled",
  "failed",
  "cleaned",
  "offline",
  "forbidden",
];
export function RemoteImportExample() {
  const [status, setStatus] = useState<RemoteImportStatus>("idle"),
    [unknown, setUnknown] = useState(false),
    [confirming, setConfirming] = useState(false),
    [event, setEvent] = useState("No remote import yet");
  return (
    <div className="grid min-w-0 gap-6">
      <FixtureStateSelect
        label="Remote import state"
        value={status}
        options={remoteStates}
        onChange={(value) => setStatus(value as RemoteImportStatus)}
      />
      <FormField layout="inline" label="Unknown download progress">
        <Checkbox
          checked={unknown}
          onCheckedChange={(value) => setUnknown(value === true)}
        />
      </FormField>
      <SampleGroup label="Actual remote import status">
        <RemoteImportView
          status={status}
          progress={unknown ? null : 25}
          estimatedSize="120 MB"
          sourceName="A remote music node"
          confirming={confirming}
          onRequest={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onRetry={() => setConfirming(true)}
          onConfirm={() => {
            setConfirming(false);
            setStatus("awaiting_approval");
            setEvent("Remote import confirmed locally");
          }}
        />
      </SampleGroup>
      <output aria-label="Remote import fixture event">{event}</output>
    </div>
  );
}
export function ContributionsExample() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [event, setEvent] = useState("No contribution action yet");
  return (
    <div className="grid min-w-0 gap-6">
      <SampleGroup label="Actual contribution cards">
        <MediaGrid>
          {[true, true, false].map((available, index) => {
            const title =
              [
                "Evening Music",
                "A contribution with a much longer album title",
                "A contribution still importing",
              ][index] ?? "Evening Music";
            const actions = buildContributionActions(
              {
                canExport: available,
                onExport: () => setEvent("Export requested locally"),
                onWithdraw: () => setOpen(true),
              },
              t,
            );
            return (
              <LibraryContributionCard
                key={index}
                title={title}
                artist="Mixed Case Artist"
                artwork={
                  <MediaCover
                    src={available ? IMAGE_SAMPLES[index] : null}
                    alt=""
                    className="size-full"
                  />
                }
                sourceLabel={index ? "Upload" : "Bandcamp"}
                onOpen={
                  available ? () => setEvent("Album opened locally") : undefined
                }
                overlay={
                  available
                    ? {
                        onPlay: () => setEvent("Play requested locally"),
                        playLabel: `Play ${title}`,
                      }
                    : undefined
                }
                renderMenu={(controller) => (
                  <ItemActionMenu
                    actions={
                      available
                        ? [
                            {
                              key: "play",
                              label: "Play album",
                              icon: Play,
                              onSelect: () =>
                                setEvent("Play requested locally"),
                            },
                            {
                              key: "open",
                              label: "Open album",
                              icon: Disc,
                              onSelect: () => setEvent("Album opened locally"),
                            },
                            { type: "divider", key: "contribution-actions" },
                            ...actions,
                          ]
                        : actions
                    }
                    header={{
                      type: "media",
                      title,
                      subtitle: "Mixed Case Artist",
                    }}
                    open={controller.open}
                    position={controller.position}
                    menuRef={controller.menuRef}
                    onClose={controller.close}
                  />
                )}
              />
            );
          })}
        </MediaGrid>
      </SampleGroup>
      <FormField layout="inline" label="Pending withdrawal">
        <Checkbox
          checked={pending}
          onCheckedChange={(value) => setPending(value === true)}
        />
      </FormField>
      <ContributionWithdrawDialog
        open={open}
        pending={pending}
        title="Remove this contribution?"
        body="Evening Music will be withdrawn. This fixture changes local state only."
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setEvent(
            t("library.contributions.toasts.removalQueued", {
              album: "Evening Music",
            }),
          );
          setOpen(false);
        }}
      />
      <output aria-label="Contributions fixture event">{event}</output>
    </div>
  );
}
