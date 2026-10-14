import type { ChapterScript } from "../director";
import { albumAction, openFirstAlbum } from "./shared";

const player: ChapterScript = async (director) => {
  const { page } = director;
  await openFirstAlbum(director);
  await director.pause(800);
  await director.click(albumAction(director, "Play"));
  await director.pause(2500);

  const open =
    director.device === "desktop" ? "Expand player" : "Open fullscreen player";
  await director.click(page.getByRole("button", { name: open }));
  await director.pause(3500);
  await director.click(page.getByRole("button", { name: "Close player" }));
  await director.pause(1200);
};

export default player;
