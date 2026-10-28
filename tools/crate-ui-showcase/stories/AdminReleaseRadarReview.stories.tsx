import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminReleaseRadarReview } from "../reviews/AdminReleaseRadarReview";

const meta = {
  id: "reviews-admin-a4-release-radar",
  title: "Reviews/Admin/A4 Release Radar",
  component: AdminReleaseRadarReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminReleaseRadarReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReleaseRadar: Story = {
  render: () => <AdminReleaseRadarReview />,
};
