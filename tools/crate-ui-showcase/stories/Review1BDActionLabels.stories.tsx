import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionLabelsReview } from "../reviews/ActionLabelsReview";
const meta = {
  id: "reviews-1bd-action-labels",
  title: "Reviews/1BD/Action labels",
  component: ActionLabelsReview,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ActionLabelsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
