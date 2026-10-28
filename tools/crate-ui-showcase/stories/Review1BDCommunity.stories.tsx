import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommunityReview } from "../reviews/CommunityReview";
const meta = {
  id: "reviews-1bd-community",
  title: "Reviews/1BD/Community",
  component: CommunityReview,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CommunityReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
