import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminEntityRecoveryReview } from "../reviews/AdminEntityRecoveryReview";

const meta = {
  id: "reviews-admin-a3-entity-recovery",
  title: "Reviews/Admin/A3 Entity Recovery",
  component: AdminEntityRecoveryReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminEntityRecoveryReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ArtistAndAlbumStates: Story = {
  render: () => <AdminEntityRecoveryReview />,
};
