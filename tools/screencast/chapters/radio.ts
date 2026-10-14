import type { ChapterScript } from "../director";
import { content } from "./shared";

const radio: ChapterScript = async (director) => {
  await director.goto("/radio");
  await director.pause(1200);
  await director.click(
    content(director).getByRole("button", { name: /Discovery Radio/ }),
  );
  await director.pause(3000);
  await director.scroll(600);
  await director.pause(1500);
  await director.scroll(-600);
  await director.pause(1000);
};

export default radio;
