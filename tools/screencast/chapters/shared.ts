import type { Device, Director } from "../director";

export const PLAYER_ALBUM = "/artists/sunny-day-real-estate/diary-remastered";
export const OFFLINE_ALBUM = "/artists/repion/repion";

export function content(director: Director) {
  return director.page.getByTestId("listen-content");
}

export function libraryPath(device: Device) {
  return device === "desktop" ? "/library?tab=albums" : "/collection/albums";
}

export async function openFirstAlbum(director: Director) {
  const card = content(director)
    .locator("article")
    .first()
    .getByRole("button", { name: /^(?!Play )/ })
    .first();
  await card.waitFor();
  const box = await card.boundingBox();
  await director.click(
    card,
    box ? { x: box.width / 2, y: box.height - 24 } : undefined,
  );
  await albumActions(director).waitFor();
}

export function albumActions(director: Director) {
  return director.page.getByTestId("album-action-row");
}

export function albumAction(director: Director, name: string) {
  return albumActions(director).getByRole("button", { name, exact: true });
}

export function openPlayer(director: Director) {
  return director.page.getByRole("button", {
    name:
      director.device === "desktop"
        ? "Expand player"
        : "Open fullscreen player",
  });
}

export function playerTab(director: Director, name: string) {
  return director.page
    .getByText(name, { exact: true })
    .filter({ visible: true })
    .last();
}

export async function warmPlayer(director: Director) {
  await director.goto(PLAYER_ALBUM);
  await albumAction(director, "Play").click();
  await openPlayer(director).click();
  await playerTab(director, "Lyrics").waitFor({ timeout: 45_000 });
  await director.pause(1500);
  await director.page
    .getByRole("button", { name: "Pause", exact: true })
    .filter({ visible: true })
    .first()
    .click();
}
