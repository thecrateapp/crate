import type { Meta, StoryObj } from "@storybook/react-vite";
import { NavigationExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-vtnavlink",
  title: "Components/Navigation/VtNavLink",
  component: NavigationExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof NavigationExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
