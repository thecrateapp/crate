import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextMenuExamples } from "../reviews/ContextMenuReview";
const meta = {
  id: "components-contextmenu",
  title: "Components/Actions/ContextMenu",
  component: ContextMenuExamples,
  args: { longLabels: false },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Uppercase MonoLabel options in desktop context menus and touch sheets. Media names retain case; active/danger colors and native navigation are preserved. Approved by Diego in 1BD.",
      },
    },
  },
} satisfies Meta<typeof ContextMenuExamples>;
export default meta;
export const Base: StoryObj<typeof meta> = {};
export const LongContent: StoryObj<typeof meta> = {
  args: { longLabels: true },
};
