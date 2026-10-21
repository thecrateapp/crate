import type { Meta, StoryObj } from "@storybook/react-vite";
import { WebClosureReview } from "../reviews/WebClosureReview";
const meta = {
  id: "reviews-1be-web-closure",
  title: "Reviews/1BE/Web closure",
  component: WebClosureReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WebClosureReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
