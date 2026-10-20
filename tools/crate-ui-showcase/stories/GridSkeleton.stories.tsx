import type { Meta, StoryObj } from "@storybook/react-vite";
import { GridSkeleton } from "@crate/ui/composites/GridSkeleton";
const meta = {
  id: "components-gridskeleton",
  title: "Components/Feedback/GridSkeleton",
  component: GridSkeleton,
  args: {
    label: "Loading albums",
    count: 4,
    density: "default",
    variant: "album",
  },
} satisfies Meta<typeof GridSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Artist: Story = {
  args: { variant: "artist", layout: "rail", count: 5 },
};
export const Station: Story = { args: { variant: "station", count: 3 } };
