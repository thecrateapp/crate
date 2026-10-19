import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlbumAccessReview } from "../reviews/AlbumAccessReview";
const meta = {
  id: "reviews-1ba-album-access",
  title: "Reviews/1BA/Album and access",
  component: AlbumAccessReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AlbumAccessReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
