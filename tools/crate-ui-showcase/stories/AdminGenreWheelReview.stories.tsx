import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminGenreWheelReview } from "../reviews/AdminGenreWheelReview";

const meta = {
  id: "reviews-admin-a3-genre-wheel",
  title: "Reviews/Admin/A3 Genre Wheel",
  component: AdminGenreWheelReview,
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    docs: {
      description: {
        component:
          "The Admin taxonomy explorer combines a tree, the full relationship wheel and a selected-genre summary. The editable cover, description, EQ and curation controls remain below the explorer.",
      },
    },
  },
} satisfies Meta<typeof AdminGenreWheelReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TaxonomyExplorer: Story = {
  render: () => <AdminGenreWheelReview />,
};
