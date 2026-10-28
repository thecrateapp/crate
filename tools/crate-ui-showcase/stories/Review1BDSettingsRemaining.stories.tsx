import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsRemainingReview } from "../reviews/SettingsRemainingReview";
const meta = {
  id: "reviews-1bd-settings-remaining",
  title: "Reviews/1BD/Remaining settings",
  component: SettingsRemainingReview,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof SettingsRemainingReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
