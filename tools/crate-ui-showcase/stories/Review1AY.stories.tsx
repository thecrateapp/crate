import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShellReview } from "../reviews/ShellReview";
const meta = {
  id: "reviews-1ay-shell",
  title: "Reviews/1AY/Shell",
  component: ShellReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ShellReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = {};
