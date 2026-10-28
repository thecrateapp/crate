import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminHealthRecoveryReview } from "../reviews/AdminHealthRecoveryReview";

const meta = {
  id: "reviews-admin-health-recovery",
  title: "Reviews/Admin/Health recovery",
  component: AdminHealthRecoveryReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminHealthRecoveryReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SnapshotAndStreamRecovery: Story = {
  render: () => <AdminHealthRecoveryReview />,
};
