import type { ChapterScript } from "../director";
import {
  albumAction,
  openPlayer,
  PLAYER_ALBUM,
  playerTab,
  warmPlayer,
} from "./shared";

export const start = () => PLAYER_ALBUM;

export const warm: ChapterScript = warmPlayer;

const player: ChapterScript = async (director) => {
  const { page } = director;
  await albumAction(director, "Play").waitFor();
  await director.pause(1000);
  await director.click(albumAction(director, "Play"));
  await director.pause(2000);
  await director.click(openPlayer(director));
  await playerTab(director, "Lyrics").waitFor();
  await director.pause(2200);
  await director.click(
    page.getByRole("button", { name: "Equalizer", exact: true }).first(),
  );
  await director.pause(2800);
  await director.click(
    page.getByRole("button", { name: "Close equalizer" }).first(),
  );
  await director.pause(700);
  await director.click(playerTab(director, "Lyrics"));
  await director.pause(3500);
};

export default player;
