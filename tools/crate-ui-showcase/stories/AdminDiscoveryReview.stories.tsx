import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminDiscoveryReview } from "../reviews/AdminDiscoveryReview";

const meta = {
  id: "reviews-admin-a3-discovery",
  title: "Reviews/Admin/A3 Discovery",
  component: AdminDiscoveryReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminDiscoveryReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HealthyWorkspace: Story = {
  render: () => <AdminDiscoveryReview />,
};

export const PartialFeedFailure: Story = {
  render: () => <AdminDiscoveryReview initialSample="partial-error" />,
};
