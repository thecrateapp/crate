import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminFederationReview } from "../reviews/AdminFederationReview";

const meta = {
  id: "reviews-admin-a5-federation",
  title: "Reviews/Admin/A5 Federation",
  component: AdminFederationReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminFederationReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = {};
