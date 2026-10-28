import type { Meta, StoryObj } from "@storybook/react-vite";
import { RadioPathsReview } from "../reviews/RadioPathsReview";
const meta = {
  id: "reviews-1bc-radio-paths",
  title: "Reviews/1BC/Radio and Paths",
  component: RadioPathsReview,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RadioPathsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
