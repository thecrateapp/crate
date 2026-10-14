import type { ChapterScript } from "../director";
import { openFirstAlbum, openLibrary } from "./shared";

const library: ChapterScript = async (director) => {
  await openLibrary(director);
  await director.pause(1200);
  await director.scroll(700);
  await director.pause(900);
  await director.scroll(-700);
  await director.pause(600);
  await openFirstAlbum(director);
  await director.pause(1500);
  await director.scroll(500);
  await director.pause(1200);
};

export default library;
