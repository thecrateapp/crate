import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
const meta = {
  id: "components-skeleton",
  title: "Components/Feedback/Skeleton",
  component: Skeleton,
  args: { className: "h-4 w-48" },
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
