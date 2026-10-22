import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminSettingsTranslationsReview } from "../reviews/AdminSettingsTranslationsReview";

const meta = {
  id: "reviews-admin-a5-settings-translations",
  title: "Reviews/Admin/A5 Settings and Translations",
  component: AdminSettingsTranslationsReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminSettingsTranslationsReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Settings: Story = { args: { initialPage: "settings" } };
export const Translations: Story = { args: { initialPage: "translations" } };
