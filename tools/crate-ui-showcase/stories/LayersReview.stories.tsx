import type { Meta, StoryObj } from "@storybook/react-vite";
import { LayersReview } from "../reviews/LayersReview";
const meta = {
  id: "reviews-1ax-layers",
  title: "Reviews/1AX/Layers",
  component: LayersReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LayersReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
