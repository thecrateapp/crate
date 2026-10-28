import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextMenuReview } from "../reviews/ContextMenuReview";
const meta = {
  id: "reviews-1bc-menus",
  title: "Reviews/1BC/Context menus",
  component: ContextMenuReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ContextMenuReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
