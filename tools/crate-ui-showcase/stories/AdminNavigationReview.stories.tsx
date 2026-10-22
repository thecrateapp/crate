import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminNavigationReview } from "../reviews/AdminNavigationReview";

const meta = {
  id: "reviews-admin-shell-solid",
  title: "Reviews/Admin/Shell",
  component: AdminNavigationReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminNavigationReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SolidHeaders: Story = {};
