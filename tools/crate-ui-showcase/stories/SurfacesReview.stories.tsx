import type { Meta, StoryObj } from "@storybook/react-vite";
import { SurfacesReview } from "../reviews/SurfacesReview";
const meta = {
  id: "reviews-1at-surfaces",
  title: "Reviews/1AT/Surfaces",
  component: SurfacesReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof SurfacesReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
