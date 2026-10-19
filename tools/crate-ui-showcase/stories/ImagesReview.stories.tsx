import type { Meta, StoryObj } from "@storybook/react-vite";
import { ImagesReview } from "../reviews/ImagesReview";
const meta = {
  id: "reviews-1av-images",
  title: "Reviews/1AV/Images",
  component: ImagesReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ImagesReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
