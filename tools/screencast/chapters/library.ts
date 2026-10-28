import type { ChapterScript, Device } from "../director";
import { content, libraryPath, openFirstAlbum } from "./shared";

export const start = (device: Device) => libraryPath(device);

export const warm: ChapterScript = async (director) => {
  await director.goto(libraryPath(director.device));
  await openFirstAlbum(director);
  await director.pause(1500);
};

const library: ChapterScript = async (director) => {
  await content(director).locator("article").first().waitFor();
  await director.pause(1200);
  await director.scroll(900);
  await director.pause(1000);
  await director.scroll(-900);
  await director.pause(800);
  await openFirstAlbum(director);
  await director.pause(1800);
  await director.scroll(600);
  await director.pause(1500);
};

export default library;
