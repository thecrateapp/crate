import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExploreBrowseReview } from "../reviews/ExploreBrowseReview";
const meta = {
  id: "reviews-1bc-explore",
  title: "Reviews/1BC/Explore and browse",
  component: ExploreBrowseReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ExploreBrowseReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
