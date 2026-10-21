import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerVisualizerReview } from "../reviews/PlayerVisualizerReview";
const meta = {
  id: "reviews-1be-player-visualizer",
  title: "Reviews/1BE/Visualizer and Analysis",
  component: PlayerVisualizerReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlayerVisualizerReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
