import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { EqBands } from "@crate/ui/domain/player/EqBands";
const gains = [3, 2, 0, -2, -3, -1, 2, 4, 4, 3];
const meta = {
  id: "components-eqbands",
  title: "Components/Media/EqBands",
  component: EqBands,
  tags: [],
  args: { gains, animate: true, trackClassName: "h-40" },
  parameters: {
    docs: {
      description: {
        component:
          "Shared ten-band EQ used by Listen and Admin. All ten bands fit the component width. Gain readouts are12px Mono400; under30rem they are rounded to whole dB, with exact signed values on touch/focus and exact aria-valuenow/aria-valuetext. No precision is lost in the curve or audio; frequency captions retain canonical uppercase MonoLabel. Values and handles update by ref in the same frame as the curve. Native vertical slider semantics: ±12dB,0.5dB steps, PageUp/Down3dB, Home/End; pointer and key changes preview through onBandInput, then commit once on release/blur/150ms idle. First paint is immediate; subsequent curves morph with the shared spring, settling without a running loop. Reduced motion/hidden states settle directly. Read-only automatic modes and disabled EQ preserve gains and prevent edits. The SVG is decorative, with value text on each band. Same presentation in Admin and Listen, no scene CSS overrides.",
      },
    },
  },
} satisfies Meta<typeof EqBands>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Manual: Story = {
  render: function ManualBands(args) {
    const [values, setValues] = useState(args.gains);
    return (
      <EqBands
        {...args}
        gains={values}
        onBandInput={(i, g) =>
          setValues((old) => old.map((v, index) => (index === i ? g : v)))
        }
        onBandChange={() => {}}
      />
    );
  },
};
export const ReadOnly: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Flat: Story = { args: { gains: Array(10).fill(0) } };
export const ReducedMotion: Story = { args: { animate: false } };
