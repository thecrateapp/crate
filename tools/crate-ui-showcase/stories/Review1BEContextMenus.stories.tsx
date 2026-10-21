import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListenContextMenusReview } from "../reviews/ListenContextMenusReview";
const meta = {
  id: "reviews-1be-context-menus",
  title: "Reviews/1BE/Context menus",
  component: ListenContextMenusReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ListenContextMenusReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
