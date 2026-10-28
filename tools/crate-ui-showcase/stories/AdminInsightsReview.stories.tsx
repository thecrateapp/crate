import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminInsightsReview } from "../reviews/AdminInsightsReview";

const meta = {
  id: "reviews-admin-a3-insights",
  title: "Reviews/Admin/A3 Insights",
  component: AdminInsightsReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminInsightsReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RetainedSnapshot: Story = {
  render: () => <AdminInsightsReview />,
};
