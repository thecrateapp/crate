import type { ChapterScript } from "../director";
import { content } from "./shared";

const paths: ChapterScript = async (director) => {
  const { page } = director;
  await director.goto("/paths");
  await director.pause(1500);
  await director.click(content(director).locator('a[href^="/paths/"]').first());
  await page.getByRole("button", { name: "Regenerate" }).waitFor();
  await director.pause(1500);
  await director.click(
    content(director)
      .getByRole("button", { name: "Play", exact: true })
      .first(),
  );
  await director.pause(2500);
  await director.scroll(500);
  await director.pause(1200);
};

export default paths;
