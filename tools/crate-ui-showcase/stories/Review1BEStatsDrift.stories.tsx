import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatsDriftReview } from "../reviews/StatsDriftReview";
const meta = {
  id: "reviews-1be-stats-drift",
  title: "Reviews/1BE/Stats row consistency",
  component: StatsDriftReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StatsDriftReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
