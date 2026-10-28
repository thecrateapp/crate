import type { Meta, StoryObj } from "@storybook/react-vite";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
const meta = {
  id: "components-infobadge",
  title: "Components/Data Display/InfoBadge",
  component: InfoBadge,
  args: { children: "FLAC", tone: "neutral" },
  argTypes: {
    tone: {
      control: "select",
      options: ["neutral", "info", "success", "warning", "danger", "accent"],
    },
    surface: { control: "radio", options: ["default", "overlay"] },
    variant: { control: "radio", options: ["label", "counter"] },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof InfoBadge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Tones: Story = {
  render: () => (
    <div className="showcase-line">
      {(
        ["neutral", "info", "success", "warning", "danger", "accent"] as const
      ).map((tone) => (
        <InfoBadge key={tone} tone={tone}>
          {tone}
        </InfoBadge>
      ))}
      <InfoBadge variant="counter">3</InfoBadge>
    </div>
  ),
};
export const LongAndComposed: Story = {
  render: () => (
    <div className="showcase-narrow showcase-stack">
      <InfoBadge>Exceptionally long metadata to inspect containment</InfoBadge>
      <InfoBadge>alias: {"composed-text-that-needs-truncation"}</InfoBadge>
    </div>
  ),
};
export const Offline: Story = {
  render: () => (
    <div className="showcase-line">
      <OfflineBadge state="queued" />
      <OfflineBadge state="downloading" />
      <OfflineBadge state="ready" />
      <OfflineBadge state="error" />
      <OfflineBadge state="ready" compact />
      <OfflineBadge state="error" compact />
    </div>
  ),
};
