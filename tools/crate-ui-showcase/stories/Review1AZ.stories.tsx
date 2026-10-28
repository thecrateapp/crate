import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerReview } from "../reviews/PlayerReview";
const meta = {
  id: "reviews-1az-player",
  title: "Reviews/1AZ/Player",
  component: PlayerReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlayerReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
