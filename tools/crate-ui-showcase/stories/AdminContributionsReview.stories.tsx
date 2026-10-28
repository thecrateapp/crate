import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminContributionsReview } from "../reviews/AdminContributionsReview";

const meta = {
  id: "reviews-admin-a5-contributions",
  title: "Reviews/Admin/A5 Contributions",
  component: AdminContributionsReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminContributionsReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complete: Story = {};
