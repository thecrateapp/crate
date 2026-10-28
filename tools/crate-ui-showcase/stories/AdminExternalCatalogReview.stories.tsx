import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AdminBandcampReview,
  AdminGlobalCatalogReview,
} from "../reviews/AdminExternalCatalogReview";

const meta = {
  id: "reviews-admin-a4-external-catalog",
  title: "Reviews/Admin/A4 External catalog",
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bandcamp: Story = {
  render: () => <AdminBandcampReview />,
};

export const GlobalCatalog: Story = {
  render: () => <AdminGlobalCatalogReview />,
};
