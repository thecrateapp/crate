import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollectionEmptyExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-emptystate",
  title: "Components/Feedback/EmptyState",
  component: CollectionEmptyExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CollectionEmptyExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const LongContent: Story = { args: { long: true } };
