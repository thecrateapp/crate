import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormsReview } from "../reviews/FormsReview";

const meta = {
  // Keep existing review links valid as the scene expands to the full 1AR scope.
  id: "reviews-1ar-field-labels",
  title: "Reviews/1AR/Forms",
  component: FormsReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof FormsReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Isolated: Story = {};
