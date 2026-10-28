import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminAcquisitionReview } from "../reviews/AdminAcquisitionReview";

const meta = {
  id: "reviews-admin-a4-acquisition",
  title: "Reviews/Admin/A4 Acquisition",
  component: AdminAcquisitionReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminAcquisitionReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchWorkspace: Story = {
  render: () => <AdminAcquisitionReview />,
};

export const ReadyToSearch: Story = {
  render: () => <AdminAcquisitionReview initialSearch={false} />,
};
