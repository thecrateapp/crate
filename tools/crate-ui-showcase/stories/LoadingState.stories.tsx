import type { Meta, StoryObj } from "@storybook/react-vite";
import { GridSkeleton } from "@crate/ui/composites/GridSkeleton";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
const meta = {
  id: "components-loadingstate",
  title: "Components/Feedback/LoadingState",
  component: LoadingState,
  args: { label: "Loading collection" },
} satisfies Meta<typeof LoadingState>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Route: Story = {
  args: { variant: "route", label: "Loading route" },
};
export const Page: Story = { args: { variant: "page", label: "Loading page" } };

export const Collection: Story = {
  args: {
    children: <GridSkeleton count={4} density="default" variant="album" />,
  },
};

export const FullWidth: Story = {
  args: { label: "Finding your music...", fullWidth: true },
};
