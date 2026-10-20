import type { Meta, StoryObj } from "@storybook/react-vite";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
const meta = {
  id: "components-monolabel",
  title: "Components/Data Display/MonoLabel",
  component: MonoLabel,
  args: { children: "Your library", as: "p", size: "label" },
  argTypes: {
    as: {
      control: "select",
      options: ["p", "span", "div", "h2", "h3", "dt", "figcaption", "legend"],
    },
    tone: { control: "radio", options: ["subtle", "accent"] },
    size: { control: "radio", options: ["label", "eyebrow"] },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof MonoLabel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const UppercaseContract: Story = {
  render: () => (
    <div className="showcase-stack">
      {(["label", "eyebrow"] as const).flatMap((size) =>
        ["normal-case", "lowercase", "capitalize"].map((className) => (
          <MonoLabel
            key={`${size}-${className}`}
            size={size}
            className={className}
          >
            Natural case {size} {className}
          </MonoLabel>
        )),
      )}
    </div>
  ),
};
export const Hierarchy: Story = {
  render: () => (
    <div className="showcase-stack">
      <MonoLabel size="eyebrow" accent="01">
        Your collection
      </MonoLabel>
      <MonoLabel>Metadata</MonoLabel>
      <MonoLabel meta={["Radiohead", "1997", "12 tracks"]} />
    </div>
  ),
};
export const LongLabel: Story = {
  render: () => (
    <div className="showcase-narrow">
      <MonoLabel>
        A long label that may wrap across several lines in a narrow container
      </MonoLabel>
    </div>
  ),
};

export const ContextualMetrics: Story = {
  render: () => (
    <div className="showcase-stack">
      <MonoLabel>84 plays</MonoLabel>
      <MonoLabel>2 albums · 0 tracks</MonoLabel>
      <MonoLabel>12 tracks · 52m</MonoLabel>
      <MonoLabel>93% match</MonoLabel>
    </div>
  ),
};

export const Accent: Story = {
  args: { children: "Interface", as: "h2", tone: "accent" },
};
export const SectionTones: Story = {
  render: () => (
    <div className="showcase-stack">
      <MonoLabel as="h2" tone="accent">
        Playback
      </MonoLabel>
      <MonoLabel>Stream quality</MonoLabel>
    </div>
  ),
};
