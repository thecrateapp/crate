import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionsReview } from "../reviews/ActionsReview";
const meta = {
  id: "reviews-1as-actions",
  title: "Reviews/1AS/Actions",
  component: ActionsReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof ActionsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
