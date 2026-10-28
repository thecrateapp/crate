import type { ChapterScript } from "../director";
import { content, openPlayer, playerTab, warmPlayer } from "./shared";

export const start = () => "/radio";

export const warm: ChapterScript = warmPlayer;

const radio: ChapterScript = async (director) => {
  const discovery = content(director).getByRole("button", {
    name: /Discovery Radio/,
  });
  await discovery.waitFor();
  await director.pause(1200);
  await director.click(discovery);
  await openPlayer(director).waitFor();
  await director.pause(2500);
  await director.click(openPlayer(director));
  await playerTab(director, "Queue").waitFor();
  await director.pause(1200);
  await director.click(playerTab(director, "Queue"));
  await director.pause(1500);
  await director.scroll(
    700,
    director.page.getByTestId("queue-track-row").nth(2),
  );
  await director.pause(2000);
};

export default radio;
