import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsReview } from "../reviews/SettingsReview";
const meta = {
  id: "reviews-1bd-settings",
  title: "Reviews/1BD/Settings",
  component: SettingsReview,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof SettingsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};

export const Account: StoryObj<typeof meta> = {
  args: { initialTab: "account" },
};
