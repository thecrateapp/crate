import type { ChapterScript } from "../director";
import { albumAction, openFirstAlbum } from "./shared";

const offline: ChapterScript = async (director) => {
  const { page } = director;
  await openFirstAlbum(director);
  await director.pause(1000);
  const makeOffline = albumAction(director, "Make available offline");
  if (await makeOffline.isVisible()) {
    await director.click(makeOffline);
    await albumAction(director, "Remove offline copy").waitFor({
      timeout: 15_000,
    });
  }
  await director.pause(1500);
  await director.goto("/settings");
  await page.getByText("Offline mirror").first().scrollIntoViewIfNeeded();
  await director.pause(2000);
};

export default offline;
