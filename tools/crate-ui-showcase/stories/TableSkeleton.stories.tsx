import type { Meta, StoryObj } from "@storybook/react-vite";
import { TableSkeleton } from "@crate/ui/composites/TableSkeleton";
const meta = {
  id: "components-tableskeleton",
  title: "Components/Feedback/TableSkeleton",
  component: TableSkeleton,
  args: { label: "Loading table", rows: 3, columns: 3 },
} satisfies Meta<typeof TableSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Narrow: Story = { args: { columns: 2, rows: 4 } };
