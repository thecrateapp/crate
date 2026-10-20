import type { Meta, StoryObj } from "@storybook/react-vite";
import { CardSkeleton } from "@crate/ui/composites/CardSkeleton";
const meta = {
  id: "components-cardskeleton",
  title: "Components/Feedback/CardSkeleton",
  component: CardSkeleton,
  args: { label: "Loading summary" },
} satisfies Meta<typeof CardSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
