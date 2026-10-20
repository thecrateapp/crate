import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollectionDetailsReview } from "../reviews/CollectionDetailsReview";
const meta = {
  id: "reviews-1bb-collection-details",
  title: "Reviews/1BB/Collection details",
  component: CollectionDetailsReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CollectionDetailsReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
