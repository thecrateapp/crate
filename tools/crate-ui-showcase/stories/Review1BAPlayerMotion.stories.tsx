import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerMotionReview } from "../reviews/PlayerMotionReview";
const meta = {
  id: "reviews-1ba-player-motion",
  title: "Reviews/1BA/Player motion and navigation",
  component: PlayerMotionReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlayerMotionReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
