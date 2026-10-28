import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollectionsReview } from "../reviews/CollectionsReview";
const meta = {
  id: "reviews-1aw-collections",
  title: "Reviews/1AW/Collections",
  component: CollectionsReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CollectionsReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
