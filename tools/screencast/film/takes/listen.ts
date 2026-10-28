import type { Page } from "@playwright/test";
import type { Device, Director } from "../../director";
import { stageJson, withoutEntries } from "../stage";
import type { Takes } from "../takes";

export const SOUNDTRACK_ALBUM = "/artists/mano-le-tough/changing-days-remixes";
export const AFTER_HOURS = "/crate/after-hours-T3S1WeH3";
export const DESTINY_ALBUM = "/artists/john-talabot/fin";
const BEAT_MS = 500;
const PLAYER_TABS: Record<Device, string[]> = {
  desktop: ["Queue", "Suggested", "Info", "Queue", "Suggested", "Info"],
  mobile: ["Queue", "Info", "Now Playing", "Queue", "Info", "Now Playing"],
};

async function freshPlayer(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("listen-player-state:v1");
    localStorage.setItem("listen-eq-enabled", "true");
  });
}

// Crate's lyrics lookup misses LRCLIB's "Destiny feat. Pional" entry, so the take serves those
// synced lyrics for that one request.
async function destinyLyrics(page: Page) {
  await freshPlayer(page);
  const search = new URL("https://lrclib.net/api/search");
  search.searchParams.set("track_name", "Destiny feat. Pional");
  search.searchParams.set("artist_name", "John Talabot");
  const results = (await (await fetch(search)).json()) as {
    syncedLyrics?: string;
    plainLyrics?: string;
  }[];
  const match = results.find((result) => result.syncedLyrics);
  if (!match) throw new Error("LRCLIB has no synced lyrics for Destiny");
  await page.route(/\/api\/lyrics\?/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("title") !== "Destiny") return route.continue();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        syncedLyrics: match.syncedLyrics,
        plainLyrics: match.plainLyrics ?? null,
      }),
    });
  });
}

function playButton(director: Director) {
  return director.page
    .getByTestId("album-action-row")
    .getByRole("button", { name: "Play", exact: true });
}

async function imagesLoaded(director: Director) {
  await director.page
    .waitForFunction(
      () => [...document.images].every((image) => image.complete),
      undefined,
      { timeout: 6000 },
    )
    .catch(() => undefined);
}

async function blurFocus(director: Director) {
  await director.page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.blur(),
  );
}

function openPlayer(director: Director) {
  return director.page
    .getByRole("button", {
      name:
        director.device === "desktop"
          ? "Expand player"
          : "Open fullscreen player",
    })
    .filter({ visible: true })
    .first();
}

function playerTab(director: Director, name: string) {
  return director.page
    .getByText(name, { exact: true })
    .filter({ visible: true })
    .last();
}

async function seekTo(director: Director, fraction: number) {
  const slider = director.page
    .getByRole("slider")
    .filter({ visible: true })
    .first();
  await slider.waitFor();
  const box = await slider.boundingBox();
  if (!box) throw new Error("No seek bar in the player");
  await slider.click({
    position: { x: box.width * fraction, y: box.height / 2 },
  });
}

async function openPlayingTrack(
  director: Director,
  play: () => Promise<void>,
  at: number,
) {
  await play();
  await director.pause(1500);
  await director.click(openPlayer(director));
  await director.pause(700);
  await blurFocus(director);
  await seekTo(director, at);
}

function browse(
  path: (device: Device) => string,
  scrollBy = 420,
): Takes[string] {
  return {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: path,
    prepare: freshPlayer,
    async run(director) {
      await blurFocus(director);
      await director.pause(900);
      if (scrollBy) await director.scroll(scrollBy);
      await imagesLoaded(director);
      await director.pause(1400);
    },
  };
}

export const TAKES: Takes = {
  library: {
    ...browse(() => "/collection/artists", 600),
    async prepare(page) {
      await freshPlayer(page);
      await stageJson(page, /\/api\/catalog\/me\/(follows|artists)/, (real) =>
        withoutEntries(real, (entry) => entry.artist_name === "Unknown Artist"),
      );
    },
  },
  everywhere: browse(() => "/", 600),
  album: {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: () => SOUNDTRACK_ALBUM,
    prepare: freshPlayer,
    async run(director) {
      await blurFocus(director);
      await director.pause(1200);
      await director.click(playButton(director));
      await director.pause(2500);
    },
  },
  player: {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: () => SOUNDTRACK_ALBUM,
    prepare: freshPlayer,
    async run(director) {
      await openPlayingTrack(
        director,
        () => director.click(playButton(director)),
        326 / 427,
      );
      await director.pause(3500);
    },
  },
  lyrics: {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: () => DESTINY_ALBUM,
    prepare: destinyLyrics,
    async run(director) {
      const destiny = director.page
        .getByRole("button", { name: "Play Destiny", exact: true })
        .first();
      await openPlayingTrack(
        director,
        () => director.click(destiny),
        134 / 294,
      );
      await director.click(playerTab(director, "Lyrics"));
      await director.pause(9000);
    },
  },
  acceleration: {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: () => SOUNDTRACK_ALBUM,
    prepare: freshPlayer,
    async run(director) {
      await openPlayingTrack(
        director,
        () => director.click(playButton(director)),
        326 / 427,
      );
      for (const tab of PLAYER_TABS[director.device]) {
        await director.click(playerTab(director, tab));
        await director.pause(BEAT_MS);
      }
    },
  },
  playlists: browse(() => "/playlist/33", 520),
  crates: {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: (device) =>
      device === "desktop" ? AFTER_HOURS : "/collection/crates",
    prepare: freshPlayer,
    async run(director) {
      await blurFocus(director);
      if (director.device === "mobile") {
        await director.pause(900);
        await director.click(
          director.page.getByText("After Hours", { exact: true }).first(),
        );
        await director.pause(2500);
        await director.scroll(500);
        await director.pause(1200);
        return;
      }
      const flow = director.page.getByTestId("crate-coverflow-frame");
      await flow.waitFor();
      const box = await flow.boundingBox();
      if (!box) throw new Error("No cover flow on the Crate page");
      const nextCover = {
        x: box.width / 2 + Math.min(box.width * 0.32, 260),
        y: box.height / 2,
      };
      await director.pause(800);
      for (let step = 0; step < 11; step++) {
        await director.click(flow, nextCover);
        await director.pause(BEAT_MS - 150);
      }
      await director.pause(800);
    },
  },
  radio: browse(() => "/radio", 360),
  paths: {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: () => "/paths",
    prepare: freshPlayer,
    async run(director) {
      await blurFocus(director);
      await director.pause(700);
      await director.click(
        director.page.getByText("The Clash → Erik Urano").first(),
      );
      await director.pause(2800);
    },
  },
  stats: browse(() => "/stats", 500),
  "home-hero": browse(() => "/", 0),
  artist: browse(() => "/artists/mano-le-tough", 320),
  explore: browse(() => "/explore", 420),
  digging: browse(() => "/stats/digging", 0),
  radar: browse(() => "/upcoming", 300),
  "crates-index": browse(() => "/collection/crates", 0),
  search: {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: () => "/search",
    prepare: freshPlayer,
    async run(director) {
      const input = director.page
        .getByRole("searchbox")
        .or(director.page.getByRole("textbox"))
        .filter({ visible: true })
        .first();
      await director.click(input);
      await input.pressSequentially("Talabot", { delay: 90 });
      await input.press("Enter");
      await director.page
        .getByText(/John Talabot/)
        .filter({ visible: true })
        .first()
        .waitFor({ timeout: 15_000 });
      await imagesLoaded(director);
      await director.pause(1500);
    },
  },
  equalizer: {
    app: "listen",
    devices: ["desktop", "mobile"],
    start: () => SOUNDTRACK_ALBUM,
    prepare: freshPlayer,
    async run(director) {
      await openPlayingTrack(
        director,
        () => director.click(playButton(director)),
        326 / 427,
      );
      await director.click(
        director.page
          .getByRole("button", { name: "Equalizer", exact: true })
          .filter({ visible: true })
          .first(),
      );
      await director.pause(2500);
    },
  },
};
