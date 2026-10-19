import { SkipExample } from "../reviews/LayersReview";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkipLink } from "@crate/ui/primitives/SkipLink";
const meta = {
  id: "components-skiplink",
  title: "Components/Navigation/SkipLink",
  component: SkipLink,
  args: { targetId: "sample-main", children: "Skip to main content" },
} satisfies Meta<typeof SkipLink>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = { render: () => <SkipExample /> };
