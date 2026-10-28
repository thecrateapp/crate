import type { Meta, StoryObj } from "@storybook/react-vite";
import { HomeLibraryReview } from "../reviews/HomeLibraryReview";
const meta = {
  id: "reviews-1bb-home-library",
  title: "Reviews/1BB/Home and Library",
  component: HomeLibraryReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HomeLibraryReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
