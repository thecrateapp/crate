import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrimaryHintsReview } from "../reviews/PrimaryHintsReview";
const meta = {
  id: "reviews-1be-primary-hints",
  title: "Reviews/1BE/Primary and tooltips",
  component: PrimaryHintsReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PrimaryHintsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
