import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminCatalogReview } from "../reviews/AdminCatalogReview";

const meta = {
  id: "reviews-admin-a3-catalog",
  title: "Reviews/Admin/A3 Catalog",
  component: AdminCatalogReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminCatalogReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrowseAndGenres: Story = {
  render: () => <AdminCatalogReview />,
};
