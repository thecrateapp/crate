import type { Meta, StoryObj } from "@storybook/react-vite";
import { OAuthExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-oauthbuttons",
  title: "Components/Actions/OAuthButtons",
  component: OAuthExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof OAuthExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Unavailable: Story = { args: { unavailable: true } };
export const Empty: Story = { args: { empty: true } };
