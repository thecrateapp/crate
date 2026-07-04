import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const srcRoot = resolve(process.cwd(), "src");

const filesToForbiddenCopy: Record<string, string[]> = {
  "components/explore/ExploreViews.tsx": [
    "No results found.",
    "Genre radio is not available yet",
    "Failed to start genre radio",
    "Loading genre.",
    "Genre not found.",
    "Related scenes",
    "Adjacent genres with the most music in your library.",
    "Loading decade.",
    "No artists found for this decade.",
    "Failed to play playlist",
    "Failed to update playlist",
    "Loading playlist category.",
    "No playlists found in this category yet.",
  ],
  "components/home/HomeSections.tsx": [
    "Good morning",
    "Good afternoon",
    "Good evening",
  ],
  "components/player/FullscreenPlayer.tsx": [
    "Added to liked tracks",
    "Removed from liked tracks",
    "Failed to update liked tracks",
    "Nothing queued",
    "Loading lyrics...",
    "No lyrics available",
  ],
  "components/player/PlayerBar.tsx": ["Loading player"],
  "components/player/extended/LyricsTab.tsx": ["No lyrics found"],
  "components/player/extended/QueueTab.tsx": [
    "Remove from queue",
    "No local tracks in queue to save",
    "Failed to save playlist",
    "History",
    "Now playing from:",
    "Save as Playlist",
    "Next up from:",
    "Queue is empty",
  ],
  "components/player/extended/InfoTab.tsx": [
    "No track info available",
    "Now Inspecting",
    "Audio Profile",
    "Mood & Feel",
    "Bliss Fingerprint",
    "Source & Dynamics",
    "No popularity signals are available for this track yet.",
  ],
  "components/bandcamp/BandcampSupportButton.tsx": [
    "Importing from Bandcamp",
    "Owned on Bandcamp",
    "Support on Bandcamp",
    "Import from Bandcamp",
    "Buy this album on Bandcamp",
    "Bandcamp import queued",
    "Failed to import from Bandcamp",
  ],
  "components/cards/ArtistCard.tsx": [
    "No top tracks available for this artist yet",
    "Failed to load top tracks",
    "Failed to update follow status",
    "Play top tracks",
  ],
  "components/playlists/PlaylistListRow.tsx": [
    "This playlist has no playable tracks yet",
    "Failed to load playlist",
  ],
  "components/playlists/PlaylistCreateModal.tsx": [
    "Edit playlist",
    "Create playlist",
    "Search tracks to add",
    "No tracks found",
    "Add tracks now or later.",
  ],
  "components/home/HomeLibrarySections.tsx": [
    "From Crate",
    "Global smart and curated playlists published from admin.",
    "No system playlists are available yet.",
    "In Your Library",
    "Your latest playlists and saved albums in one place.",
    "Start saving albums or creating playlists",
    "Just landed",
    "Fresh additions arriving in the shared Crate library.",
    "No recent global additions yet.",
  ],
  "components/settings/ConnectDevicesSection.tsx": [
    "Failed to load Crate Connect devices",
    "Failed to revoke device",
    "Failed to update Crate Connect",
    "Loading devices...",
    "No active Crate Connect devices right now.",
  ],
  "components/social/ProfileHoverCard.tsx": [
    "Still finding their sound",
    "No username",
    "Loading profile card",
    "Could not load this profile right now.",
  ],
  "components/stats/StatsPanels.tsx": [
    "Loading trend data...",
    "Start listening and your daily curve will appear here.",
  ],
  "pages/Home.tsx": [
    "Failed to update recommendation",
    "No top tracks available yet",
    "Failed to load artist tracks",
    "Failed to update follow status",
    "This playlist is still warming up",
    "Failed to load playlist",
    "Failed to start playlist radio",
    "Saved for later",
    "Failed to save reminder",
    "No probable setlist tracks matched your library",
    "Failed to load probable setlist",
    "Loading home.",
  ],
  "pages/HomeSection.tsx": [
    "This playlist is still warming up",
    "Failed to load playlist",
    "Failed to start playlist radio",
    "Failed to start radio",
    "Loading section.",
    "Section not found",
    "Nothing ready here yet",
    "Crate could not find enough playable",
  ],
  "pages/Bandcamp.tsx": [
    "Bandcamp import queued",
    "Failed to import Bandcamp item",
    "Bandcamp account",
    "Bandcamp item",
  ],
  "pages/Library.tsx": [
    "Bandcamp import queued",
    "Failed to import Bandcamp item",
    "Bandcamp removal queued",
    "Failed to remove Bandcamp contribution",
    "Synced purchases",
    "Imported into Crate",
    "No Bandcamp purchases synced yet",
    "Remove Bandcamp contribution?",
    "Remove contribution?",
    "You have not contributed any albums yet.",
  ],
  "pages/ArtistTopTracks.tsx": [
    "No top tracks available for this artist yet",
    "Loading top tracks.",
    "Top Tracks",
  ],
  "pages/Settings.tsx": [
    "Offline copies synced",
    "Failed to sync offline copies",
    "Not connected",
    "Connect in a dedicated Bandcamp desktop window",
    "Connected accounts",
    "Save profile",
    "Change password",
    "Search for a city...",
  ],
  "pages/Stats.tsx": [
    "No surge yet",
    "No new obsession yet",
    "No comeback yet",
    "No rhythm yet",
    "Loading replay...",
    "No listening signal recorded this day.",
    "No top tracks yet.",
    "No top artists yet.",
    "No top albums yet.",
  ],
};

describe("phase 2 listen i18n migration", () => {
  it("keeps migrated surfaces from reintroducing hardcoded visible copy", () => {
    for (const [relativePath, forbiddenCopy] of Object.entries(
      filesToForbiddenCopy,
    )) {
      const source = readFileSync(resolve(srcRoot, relativePath), "utf8");

      for (const copy of forbiddenCopy) {
        expect(
          source,
          `${relativePath} should translate "${copy}"`,
        ).not.toContain(copy);
      }
    }
  });
});
