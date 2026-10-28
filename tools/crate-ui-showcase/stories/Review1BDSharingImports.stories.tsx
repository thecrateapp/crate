import type { Meta, StoryObj } from "@storybook/react-vite";
import { SharingImportsReview } from "../reviews/SharingImportsReview";
const meta = {
  id: "reviews-1bd-sharing-imports",
  title: "Reviews/1BD/Sharing and imports",
  component: SharingImportsReview,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SharingImportsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
