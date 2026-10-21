import type { Meta, StoryObj } from "@storybook/react-vite";
import { NativeChromeReview } from "../reviews/NativeChromeReview";
const meta = {
  id: "reviews-1be-native-chrome",
  title: "Reviews/1BE/Native shells",
  component: NativeChromeReview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NativeChromeReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
export const Capacitor: StoryObj<typeof meta> = {
  args: { initialMobile: true },
};
