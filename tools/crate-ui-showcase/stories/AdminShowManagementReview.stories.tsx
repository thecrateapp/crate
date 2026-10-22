import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminShowManagementReview } from "../reviews/AdminShowManagementReview";

const meta = {
  id: "reviews-admin-a4-show-management",
  title: "Reviews/Admin/A4 Show Management",
  component: AdminShowManagementReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminShowManagementReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsAndSetlists: Story = {
  render: () => <AdminShowManagementReview />,
};
