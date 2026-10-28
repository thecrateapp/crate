import type { Meta, StoryObj } from "@storybook/react-vite";
import { OfflineReview } from "../reviews/OfflineReview";
const meta = {
  id: "listen-offline",
  title: "Listen/Offline",
  component: OfflineReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual OfflineLibraryView, OfflineSettingsView and OfflineDownloadsView. Saved per-track quality/duration use canonical TrackRowContent; only verified local tracks reach the real library. Offline downloads cache one640px cover per album (plus available manifest covers) in the same profile as the audio; CrateImage resolves a local lease before remote/responsive sources. Library rows and downloads use MediaCover48px, and missing covers keep their fallback without invalidating audio. Canonical cover identity survives reload; object URLs never enter saved snapshots or queues. Old downloads backfill on an online sync; shared covers survive until their last reference is removed. Names/artist identities retain case, technical captions use MonoLabel; source quality never comes from an album. Downloads show localized StatusDot states and count-based ProgressHairline, with unknown totals indeterminate and total file size distinguished from downloaded bytes. Existing global sync/clear callbacks, native/browser quota gates, read-only offline identity, profile isolation and engine authority remain in Listen adapters. No fictitious per-item cancel/retry or byte progress. Fixtures neither call APIs nor write storage/preferences or play audio. Includes partial/empty/buffering playback, unknown metadata/totals/quota, error/queued/downloading/syncing/ready, unsupported and read-only. The approved mockup/previous amendments remain the visual reference; full native/device and phase QA remain separate. Artwork samples are self-contained local images, including missing artwork; persistence is verified by runtime tests rather than fixture storage writes. Web and native decode staged artwork before publication; persisted corrupt images are evicted for repair on the next sync. Per-profile/asset notifications preserve unrelated cover leases. Meter owns single-line readings and a responsive caption layout, including the explicit Basque704px test case.",
      },
    },
  },
} satisfies Meta<typeof OfflineReview>;
export default meta;
export const Library: StoryObj<typeof meta> = {
  args: { initialTab: "library" },
};
export const DownloadsAndStorage: StoryObj<typeof meta> = {
  args: { initialTab: "storage" },
};
