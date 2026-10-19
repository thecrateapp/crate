import { BoundaryExample } from "../reviews/LayersReview";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppErrorBoundary } from "@crate/ui/primitives/AppErrorBoundary";
const meta = {
  id: "components-apperrorboundary",
  title: "Components/Feedback/AppErrorBoundary",
  component: AppErrorBoundary,
  args: { children: <p>Content renders normally.</p> },
} satisfies Meta<typeof AppErrorBoundary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = { render: () => <BoundaryExample /> };
