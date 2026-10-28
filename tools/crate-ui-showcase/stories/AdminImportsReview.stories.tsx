import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminImportsReview } from "../reviews/AdminImportsReview";

const meta = {
  id: "reviews-admin-a4f-staged-imports",
  title: "Reviews/Admin/A4f Staged Imports",
  component: AdminImportsReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminImportsReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const QueueAndPortableMetadata: Story = {};
