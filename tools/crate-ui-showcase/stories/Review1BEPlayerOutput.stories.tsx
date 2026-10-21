import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerOutputReview } from "../reviews/PlayerOutputReview";
const meta = {
  id: "reviews-1be-player-output",
  title: "Reviews/1BE/Output and Devices",
  component: PlayerOutputReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlayerOutputReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
