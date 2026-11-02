import type { Meta, StoryObj } from "@storybook/react-vite";
import { StackMapReview } from "../reviews/StackMapReview";

const meta = {
  id: "reviews-admin-stack-map",
  title: "Reviews/Admin/Stack Map",
  component: StackMapReview,
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    docs: {
      description: {
        component:
          "The actual Admin StackMap instrument: one host, independently deployed application and observability, selectable service neighborhoods, keyboard navigation and a linked inspector. Local sample data only; stale and unavailable states preserve topology without presenting old metrics as live.",
      },
    },
  },
} satisfies Meta<typeof StackMapReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Interactive: Story = { render: () => <StackMapReview /> };
