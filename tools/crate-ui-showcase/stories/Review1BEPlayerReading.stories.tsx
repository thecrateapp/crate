import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerReadingReview } from "../reviews/PlayerReadingReview";
const meta = {
  id: "reviews-1be-player-reading",
  title: "Reviews/1BE/Lyrics and Info",
  component: PlayerReadingReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlayerReadingReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
