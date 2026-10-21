import type { Meta, StoryObj } from "@storybook/react-vite";
import { TrackDataReview } from "../reviews/TrackDataReview";
const meta = {
  id: "reviews-1be-track-data",
  title: "Reviews/1BE/Track data consistency",
  component: TrackDataReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TrackDataReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
