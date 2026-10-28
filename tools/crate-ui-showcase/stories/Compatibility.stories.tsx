import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CrateBadge,
  CrateChip,
  CratePill,
} from "@crate/ui/primitives/CrateBadge";
import { Badge } from "@crate/ui/shadcn/badge";
function Example() {
  return (
    <div className="showcase-line">
      <CrateBadge size="sm">CrateBadge sm</CrateBadge>
      <CrateBadge size="md">CrateBadge md</CrateBadge>
      <CrateChip>CrateChip</CrateChip>
      <CratePill>Static CratePill</CratePill>
      <Badge>Badge</Badge>
    </div>
  );
}
const meta = {
  id: "components-badge-compatibility",
  title: "Components/Compatibility/Badge compatibility",
  component: Example,
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
