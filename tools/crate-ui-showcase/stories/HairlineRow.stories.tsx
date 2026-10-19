import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
function Example() {
  const [selected, setSelected] = useState(0);
  return (
    <HairlineList label="Sample tracks">
      {["Everything in Its Right Place", "Daydreaming"].map((title, i) => (
        <HairlineRow
          asChild
          key={title}
          index={i + 1}
          active={selected === i}
          trailing="4:11"
        >
          <button
            type="button"
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
          >
            {title}
          </button>
        </HairlineRow>
      ))}
    </HairlineList>
  );
}
const meta = {
  id: "components-hairlinerow",
  title: "Components/Data Display/HairlineRow",
  component: Example,
  parameters: {
    docs: {
      description: {
        component:
          "HairlineRow owns text-row geometry and uses the shared selection gradient. Track rows reuse the surface with their own media geometry; only track rows illuminate on pointer hover.",
      },
    },
  },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const ActiveWithoutIndex: Story = {
  render: () => (
    <HairlineList label="Minimal row without compensation">
      <HairlineRow active>Active row</HairlineRow>
    </HairlineList>
  ),
};
export const Multiline: Story = {
  render: () => (
    <div className="showcase-narrow">
      <HairlineList label="Multiline list">
        <HairlineRow index={1} truncate={false}>
          Multiline content to inspect real spacing without compensating CSS.
        </HairlineRow>
      </HairlineList>
    </div>
  ),
};
export const Link: Story = {
  render: () => (
    <HairlineList>
      <HairlineRow asChild index={1}>
        <a href="#destination">Open details</a>
      </HairlineRow>
    </HairlineList>
  ),
};
export const LongTitles: Story = {
  render: () => (
    <div className="showcase-narrow">
      <HairlineList label="Long titles">
        <HairlineRow asChild index={104} trailing="100%">
          <button type="button" title={"LongUnbrokenTitle".repeat(16)}>
            {"LongUnbrokenTitle".repeat(16)}
          </button>
        </HairlineRow>
        <HairlineRow index={2} truncate={false}>
          {"LongUnbrokenTitle".repeat(16)}
        </HairlineRow>
      </HairlineList>
    </div>
  ),
};
export const TypographyContext: Story = {
  render: () => (
    <div className="font-mono text-2xl font-bold">
      <HairlineList label="Typography independence">
        <HairlineRow>Canonical row typography</HairlineRow>
        <HairlineRow asChild>
          <button type="button">Canonical button typography</button>
        </HairlineRow>
      </HairlineList>
    </div>
  ),
};
