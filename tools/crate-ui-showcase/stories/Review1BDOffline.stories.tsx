import type { Meta, StoryObj } from "@storybook/react-vite";
import { OfflineReview } from "../reviews/OfflineReview";
const meta = {
  id: "reviews-1bd-offline",
  title: "Reviews/1BD/Offline",
  component: OfflineReview,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof OfflineReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
