import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpcomingShowsReview } from "../reviews/UpcomingShowsReview";
const meta = {
  id: "reviews-1bc-upcoming-shows",
  title: "Reviews/1BC/Upcoming and shows",
  component: UpcomingShowsReview,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof UpcomingShowsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
