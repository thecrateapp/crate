import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerEqReview } from "../reviews/PlayerEqReview";
const meta = {
  id: "reviews-1be-player-eq",
  title: "Reviews/1BE/Equalizer",
  component: PlayerEqReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlayerEqReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
