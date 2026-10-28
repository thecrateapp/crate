import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminStatusColorsReview } from "../reviews/AdminStatusColorsReview";

const meta = {
  id: "reviews-admin-status-colors",
  title: "Reviews/Admin/Status colors",
  component: AdminStatusColorsReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminStatusColorsReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SemanticPalette: Story = {
  render: () => <AdminStatusColorsReview />,
};
