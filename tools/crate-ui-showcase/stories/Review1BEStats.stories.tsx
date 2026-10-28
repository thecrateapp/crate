import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatsDiggingReview } from "../reviews/StatsDiggingReview";
const meta = {
  id: "reviews-1be-stats",
  title: "Reviews/1BE/Stats and Digging",
  component: StatsDiggingReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StatsDiggingReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
