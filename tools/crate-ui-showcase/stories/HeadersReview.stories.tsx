import type { Meta, StoryObj } from "@storybook/react-vite";
import { HeadersReview } from "../reviews/HeadersReview";
const meta = {
  id: "reviews-1au-headers",
  title: "Reviews/1AU/Headers",
  component: HeadersReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof HeadersReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
