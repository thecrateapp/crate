import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const ARBITRARY_VALUE =
  /(?<![\w[-])(?:rounded(?:-[a-z]+)?-\[[^\]\s]+\]|z-\[[^\]\s]+\]|shadow-\[[^\]\s]+\]|text-\[\d*\.?\d+(?:px|rem)\]|tracking-\[[^\]\s]+\])/g;
const LOCAL_STACKING = /^z-\[[1-9]\]$/;
const INHERITED_RADIUS = "rounded-[inherit]";
const ORGANIC_BLOB_RADIUS = "rounded-[45%_55%_49%_51%/53%_47%_56%_44%]";
const ICON_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*["']@crate\/ui\/icons(?:\/[^"']+)?["']/g;
const DYNAMIC_ICON = /^(?:[A-Z]\w*)?Icon$/;

const ARBITRARY_VALUE_BUDGET: Record<string, Record<string, number>> = {
  "components/album/ReleaseCountdown.tsx": {
    "tracking-[-0.075em]": 1,
    "tracking-[0.13em]": 1,
  },
  "components/cards/TrackRowParts.tsx": { [ORGANIC_BLOB_RADIUS]: 1 },
  "components/dev/TauriDevLogPanel.tsx": {
    "text-[0.65rem]": 1,
    "text-[0.68rem]": 1,
  },
  "components/home/HomeListeningHistory.tsx": { "tracking-[-0.035em]": 1 },
  "components/layout/MobileBottomNav.tsx": { "text-[0.59375rem]": 3 },
  "components/layout/sidebar/SidebarBrand.tsx": {
    "rounded-[18px]": 1,
    "rounded-[22px]": 1,
  },
  "components/layout/sidebar/SidebarNavigation.tsx": { "text-[0.75rem]": 1 },
  "components/layout/topbar/TopBarSearchView.tsx": {
    "text-[16px]": 1,
    "tracking-[-0.01em]": 1,
  },
  "components/player/ExtendedPlayerTabs.tsx": { "text-[0.75rem]": 1 },
  "components/player/FullscreenPlayerTabs.tsx": {
    "text-[1.45rem]": 1,
    "text-[1.55rem]": 2,
    "text-[1.9rem]": 1,
  },
  "components/player/LyricsPanel.tsx": {
    "text-[0.875rem]": 3,
    "text-[17px]": 1,
  },
  "components/player/PlayerTrackIdentity.tsx": { "text-[0.75rem]": 1 },
  "components/player/SpectrumPlayButton.tsx": { [ORGANIC_BLOB_RADIUS]: 1 },
  "components/player/bar/PlayerBarView.tsx": { "rounded-t-[2rem]": 1 },
  "components/player/extended/InfoTabPrimitives.tsx": { "text-[0.75rem]": 1 },
  "components/player/extended/LyricsLine.tsx": {
    "text-[0.875rem]": 2,
    "text-[17px]": 1,
  },
  "components/player/extended/LyricsTab.tsx": { "text-[0.875rem]": 1 },
  "components/player/extended/QueueTabCurrentTrack.tsx": {
    "text-[0.75rem]": 1,
  },
  "components/player/extended/SuggestedTrackRow.tsx": { "text-[0.75rem]": 1 },
  "components/playlists/EditorialPlaylistArtwork.tsx": {
    "rounded-[3px]": 1,
    "tracking-[-0.09em]": 1,
    "tracking-[0.13em]": 1,
  },
  "components/radio/RadioStationCard.tsx": { "tracking-[0.06em]": 1 },
  "components/settings/ServersSection.tsx": { "text-[0.75rem]": 1 },
  "components/social/ProfileHoverCardContent.tsx": { "text-[8rem]": 1 },
  "components/upcoming/UpcomingShowCollapsedView.tsx": { "text-[1.25rem]": 1 },
  "i18n/translation-mode/TranslationOverlay.tsx": { "rounded-[4px]": 1 },
  "pages/ExploreLandingSections.tsx": { "tracking-[-0.035em]": 1 },
  "pages/PathDetail.tsx": { "text-[0.75rem]": 1 },
  "pages/Paths.tsx": { "text-[0.75rem]": 1 },
  "pages/ServerSetup.tsx": { "text-[0.75rem]": 1 },
  "pages/Stats.tsx": { "tracking-[-0.085em]": 1 },
  "pages/StatsCollectionPanels.tsx": {
    "text-[8.5rem]": 1,
    "tracking-[-0.12em]": 1,
  },
  "pages/StatsStorySections.tsx": { "tracking-[-0.07em]": 1 },
  "pages/UserProfileTaste.tsx": { "tracking-[0.08em]": 1 },
};

const ICON_SIZE_BUDGET: Record<string, Record<string, number>> = {
  "components/album/AlbumHero.tsx": { "64": 1 },
  "components/jam/JamRoomPlaybackSections.tsx": { "22": 1 },
  "components/player/FullscreenPlayerArtwork.tsx": { "64": 1 },
  "components/player/FullscreenPlayerControls.tsx": { "26": 2 },
  "components/player/FullscreenPlayerHeader.tsx": { "28": 1 },
  "components/player/SpinningDiscArtwork.tsx": { "88": 1 },
  "components/player/SpinningDiscControl.tsx": { "22": 3 },
  "components/player/extended/InfoTabHeroArtwork.tsx": { "28": 1 },
  "pages/CrateInvite.tsx": { "22": 1 },
  "pages/JamInvite.tsx": { "22": 1 },
  "pages/Paths.tsx": { "22": 1 },
  "pages/PlaylistInvite.tsx": { "22": 1 },
  "pages/SearchAlbumResults.tsx": { "32": 1 },
  "pages/StatsAnalyticsSections.tsx": { "22": 1 },
  "pages/StatsCollectionPanels.tsx": { "22": 1 },
  "pages/StatsListeningPulse.tsx": { "22": 1 },
};

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    if (
      !entry.isFile() ||
      entry.name.includes(".test.") ||
      !/\.(?:ts|tsx)$/.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

function tally(
  findings: Array<[file: string, key: string]>,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const [file, key] of findings) {
    const counts = (result[file] ??= {});
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return result;
}

function iconNames(source: string): string[] {
  return Array.from(source.matchAll(ICON_IMPORT)).flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map(
        (name) =>
          name
            .trim()
            .split(/\s+as\s+/)
            .pop()
            ?.trim() ?? "",
      )
      .filter((name) => /^[A-Z]/.test(name) && name !== "CRATE_ICON_SIZE"),
  );
}

function literalIconSizes(source: string): string[] {
  const names = new Set(iconNames(source));
  return Array.from(
    source.matchAll(/<([A-Z]\w*)\b[^<>]*?\bsize=\{(\d+)\}/g),
  ).flatMap(([, name, size]) =>
    names.has(name!) || DYNAMIC_ICON.test(name!) ? [size!] : [],
  );
}

describe("Listen design token policy", () => {
  it("keeps arbitrary radius, z-index, shadow, type size and tracking values within the budget", () => {
    const findings = productionSourceFiles(SOURCE_ROOT).flatMap((path) => {
      const file = relative(SOURCE_ROOT, path);
      return Array.from(
        readFileSync(path, "utf8").matchAll(ARBITRARY_VALUE),
        ([utility]) => utility,
      )
        .filter(
          (utility) =>
            !LOCAL_STACKING.test(utility) && utility !== INHERITED_RADIUS,
        )
        .map((utility): [string, string] => [file, utility]);
    });

    expect(tally(findings)).toEqual(ARBITRARY_VALUE_BUDGET);
  }, 15_000);

  it("sizes icons from CRATE_ICON_SIZE outside the artwork and display budget", () => {
    const findings = productionSourceFiles(SOURCE_ROOT).flatMap((path) => {
      const file = relative(SOURCE_ROOT, path);
      return literalIconSizes(readFileSync(path, "utf8")).map(
        (size): [string, string] => [file, size],
      );
    });

    expect(tally(findings)).toEqual(ICON_SIZE_BUDGET);
  }, 15_000);
});
