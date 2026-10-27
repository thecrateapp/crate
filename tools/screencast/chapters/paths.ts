import type { ChapterScript } from "../director";
import { content } from "./shared";

export const start = () => "/paths";

const paths: ChapterScript = async (director) => {
  const { page } = director;
  const saved = content(director).locator('a[href^="/paths/"]').first();
  await saved.waitFor();
  await director.pause(1500);
  await director.click(saved);
  await page.getByRole("button", { name: "Regenerate" }).waitFor();
  await director.pause(1500);
  await director.click(
    content(director)
      .getByRole("button", { name: "Play", exact: true })
      .first(),
  );
  await director.pause(2500);
  await director.scroll(600);
  await director.pause(1800);
};

export default paths;
