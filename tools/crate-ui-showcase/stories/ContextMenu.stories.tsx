import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextMenuExamples } from "../reviews/ContextMenuReview";
const meta = {
  id: "components-contextmenu",
  title: "Components/Actions/ContextMenu",
  component: ContextMenuExamples,
  args: { longLabels: false },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ContextMenuExamples>;
export default meta;
export const Base: StoryObj<typeof meta> = {};
export const LongContent: StoryObj<typeof meta> = {
  args: { longLabels: true },
};
