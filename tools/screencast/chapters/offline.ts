import type { ChapterScript } from "../director";
import { albumAction, OFFLINE_ALBUM } from "./shared";

export const start = () => OFFLINE_ALBUM;

export const warm: ChapterScript = async (director) => {
  await director.goto(OFFLINE_ALBUM);
  await director.pause(1000);
  const remove = albumAction(director, "Remove offline copy");
  if (await remove.isVisible()) await remove.click();
};

const offline: ChapterScript = async (director) => {
  const { page } = director;
  const makeOffline = albumAction(director, "Make available offline");
  await makeOffline.waitFor();
  await director.pause(1000);
  await director.click(makeOffline);
  await albumAction(director, "Remove offline copy").waitFor({
    timeout: 30_000,
  });
  await director.pause(1800);
  await director.navigate("/settings");
  const title = page.getByText("Offline mirror", { exact: true }).first();
  const note = page.getByText(/Marked items keep a local mirror/).first();
  await note.waitFor();
  await director.pause(800);
  const viewport = page.viewportSize();
  const [titleBox, noteBox] = await Promise.all([
    title.boundingBox(),
    note.boundingBox(),
  ]);
  if (titleBox && noteBox && viewport) {
    const fitNote = noteBox.y + noteBox.height + 80 - viewport.height;
    await director.scroll(Math.max(0, Math.min(fitNote, titleBox.y - 84)));
  }
  await director.pause(2500);
};

export default offline;
